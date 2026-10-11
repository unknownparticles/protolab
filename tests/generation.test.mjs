import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBase, parseGenerationResponse, requestAI, DESIGN_SPEC } from '../src/ai.js';
import { emptyProject } from '../src/projects.js';
const clean = value => value.replace(/<script>.*?<\/script>/g, '');
const item = { id: 'generated', name: '卡片', type: 'html', content: '<div>卡片</div><script>bad()</script>', x: 0, y: 0, width: 240, height: 140 };
const container = { id: 'section', name: '内容区', type: 'html', content: '<div></div>', x: 0, y: 0, width: 240, height: 320, padding: '0', container: { mode: 'vertical', gap: 40 }, appearance: { background: 'transparent' } };
const reply = changes => JSON.stringify({ version: 1, name: '欢迎卡片', summary: '已生成欢迎卡片', changes });
test('独立生成基于空白画布，组件保存尺寸与清理后的内容', () => {
  const source = emptyProject(); source.items.push({ ...item });
  const base = generationBase(source, 'component');
  assert.equal(base.items.length, 0); assert.equal(base.pages, undefined);
  const result = parseGenerationResponse(reply([{ op: 'add', item }]), base, 'component', clean);
  assert.equal(result.component.defaultWidth, 240); assert.equal(result.component.defaultHeight, 140);
  assert.equal(result.component.content, '<div>卡片</div>');
  assert.equal(result.project.canvas.width, 240);
  assert.equal(source.items.length, 1);
});
test('页面生成允许调整画布并拆分组件，拒绝修改删除、跨页引用和空结果', () => {
  const base = generationBase(emptyProject(), 'page');
  const result = parseGenerationResponse(reply([{ op: 'canvas', fields: { width: 768, height: 1024 } }, { op: 'add', item: container }, { op: 'add', item: { ...item, parentId: container.id } }, { op: 'add', item: { ...item, id: 'second', y: 180, parentId: container.id } }]), base, 'page', clean);
  assert.equal(result.project.items.length, 3); assert.equal(result.project.canvas.width, 768);
  for (const changes of [[], [{ op: 'remove', id: 'existing' }], [{ op: 'update', id: 'existing', fields: { name: '覆盖' } }], [{ op: 'add', item: { ...item, interaction: { type: 'navigate', targetId: 'page-home' } } }]]) {
    assert.throws(() => parseGenerationResponse(reply(changes), base, 'page', clean));
  }
  assert.throws(() => parseGenerationResponse(reply([{ op: 'add', item }, { op: 'add', item: { ...item, id: 'two' } }]), generationBase(emptyProject(), 'component'), 'component', clean), /一个/);
  assert.throws(() => parseGenerationResponse(reply([{ op: 'add', item: { ...item, content: '<script>bad()</script>' } }]), base, 'page', clean), /可用内容/);
  assert.throws(() => parseGenerationResponse('not json', base, 'page', clean), /JSON/);
});
test('生成请求同时注入固定协议、内置规范与工程规范，独立任务不带修改对话', async () => {
  let sent;
  await requestAI({ url: 'https://example.com/v1', model: 'test' }, '设计登录页', generationBase(emptyProject(), 'page'), [{ role: 'user', content: '删除原有组件' }], new AbortController().signal, async (_, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply([{ op: 'add', item }]) } }] }) };
  }, { mode: 'page', rules: '紫色主色，圆角十二像素' });
  assert.equal(sent.messages.length, 2);
  assert.ok(sent.messages[0].content.includes(DESIGN_SPEC));
  assert.match(sent.messages[0].content, /紫色主色/); assert.match(sent.messages[0].content, /独立生成新页面/);
  const task = JSON.parse(sent.messages[1].content);
  assert.equal(task.mode, 'page'); assert.equal(task.requirement, '设计登录页'); assert.equal(task.project.items.length, 0);
});
