import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferenceSpec, layoutReference } from '../src/ai-reference.js';
import { generationBase, parseGenerationResponse, requestAI } from '../src/ai.js';
import { emptyProject } from '../src/projects.js';
const item = { id: 'title', name: '标题', type: 'html', content: '<h1 style="font-size:24px;color:#2563eb">确认删除</h1>', x: 12, y: 20, width: 240, height: 60 };
const reply = changes => JSON.stringify({ version: 1, name: '生成名称', summary: '完成', changes });

test('参考表校验尺寸、字号和间距，排版参考提供实际安全区、组件坐标和文字比例', () => {
  assert.throws(() => normalizeReferenceSpec({ width: 20 }, 'popup'), /范围/);
  assert.equal(normalizeReferenceSpec({ width: 20 }, 'component').width, 20);
  assert.throws(() => normalizeReferenceSpec({ bodyFont: 0 }), /范围/);
  const project = emptyProject(); project.items = [item];
  project.safeArea = { enabled: true, top: 10, right: 15, bottom: 20, left: 25 };
  const ref = layoutReference(project, { bodyFont: 16, titleFont: 32 });
  assert.equal(ref.typography.titleRatio, 2);
  assert.equal(ref.components[0].fontRatio, 1.5);
  assert.equal(ref.components[0].color, '#2563eb');
  assert.equal(ref.components[0].function, '确认删除');
  assert.equal(ref.layout.bounds.x, 25); assert.equal(ref.components[0].x, 12);
});

test('弹窗独立生成保留指定尺寸和名称，关闭外框与安全区且拒绝修改已有内容', () => {
  const spec = { name: '删除确认', width: 480, height: 300 };
  const base = generationBase(emptyProject(), 'popup', { safeArea: { enabled: true, top: 40 } }, null, spec);
  assert.equal(base.frame.style, 'none'); assert.equal(base.safeArea.enabled, false);
  const result = parseGenerationResponse(reply([{ op: 'canvas', fields: { width: 900, height: 800 } }, { op: 'add', item: { ...item, id: 'section', name: '弹窗容器', content: '<div></div>', container: { mode: 'vertical', gap: 0 } } }, { op: 'add', item: { ...item, parentId: 'section' } }]), base, 'popup', v => v, { referenceSpec: spec });
  assert.equal(result.name, spec.name); assert.equal(result.project.canvas.width, 480); assert.equal(result.project.canvas.height, 300);
  assert.throws(() => parseGenerationResponse(reply([{ op: 'remove', id: 'title' }]), base, 'popup', v => v));
  const componentBase = generationBase(emptyProject(), 'component', null, null, { width: 80, height: 40 });
  const component = parseGenerationResponse(reply([{ op: 'add', item }]), componentBase, 'component', v => v, { referenceSpec: { width: 80, height: 40 } });
  assert.equal(component.component.defaultWidth, 80); assert.equal(component.component.defaultHeight, 40);
});

test('组件、页面、弹窗及优化任务均携带图片、基础参考和排版限制，优化保留历史', async () => {
  const image = { dataURL: 'data:image/png;base64,AA==', width: 375, height: 667 };
  for (const mode of ['component', 'page', 'popup', 'modify']) {
    let sent;
    await requestAI({ url: 'https://example.test/v1', model: 'vision' }, '参考生成', emptyProject(), [{ role: 'user', content: '之前需求' }], undefined,
      async (_, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: reply([]) } }] }) }; },
      { mode, referenceImage: image, referenceSpec: { name: '确认操作', color: '#2563eb', function: '删除', bodyFont: 20, titleFont: 30 } });
    const content = sent.messages.at(-1).content;
    assert.equal(content[1].image_url.url, image.dataURL);
    const task = JSON.parse(content[0].text);
    assert.equal(task.mode, mode); assert.equal(task.referenceSpec.function, '删除');
    assert.equal(task.layoutReference.typography.titleRatio, 1.5);
    assert.equal(task.layoutReference.layout.maxItems, 200);
    assert.equal(sent.messages.length, mode === 'modify' ? 3 : 2);
  }
});
