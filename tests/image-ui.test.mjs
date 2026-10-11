import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBase, parseGenerationResponse, requestAI } from '../src/ai.js';
import { imageCanvasSize, validateReferenceImage, nameImageComponents } from '../src/image-ui.js';
import { emptyProject } from '../src/projects.js';

const image = { dataURL: 'data:image/png;base64,YWJj', width: 375, height: 667 };
const clean = text => text.replace(/<script>.*?<\/script>/g, '');
const heading = { id: 'title', name: '登录标题', type: 'html', content: '<h1>欢迎登录</h1><script>bad()</script>', x: 20, y: 40, width: 200, height: 50 };
const button = { id: 'submit', name: '登录按钮', type: 'html', content: '<button>登录</button>', x: 20, y: 150, width: 200, height: 40 };
const reply = changes => JSON.stringify({ version: 1, name: '图片登录页', summary: '已还原登录界面', changes });
const base = () => generationBase(emptyProject(), 'image', undefined, image);

test('参考图等比缩放，拒绝不支持格式、过小、过长和过大图片', () => {
  assert.deepEqual(imageCanvasSize(1500, 3000), { width: 1000, height: 2000 });
  assert.deepEqual(imageCanvasSize(375, 667), { width: 375, height: 667 });
  for (const size of [[99, 300], [NaN, 300], [100, 10000]]) assert.throws(() => imageCanvasSize(...size));
  for (const invalid of [null, { ...image, dataURL: 'https://example.com/a.png' }, { ...image, dataURL: 'data:image/svg+xml;base64,YWJj' }, { ...image, dataURL: 'data:image/png;base64,' + 'A'.repeat(4_200_000) }]) assert.throws(() => validateReferenceImage(invalid));
});
test('图片空白画布隔离工程配色安全区，生成保留尺寸并清理内容、补全唯一语义名称', () => {
  const context = { safeArea: { enabled: true, top: 100, left: 100 }, palette: { colors: { background: '#7c3aed' } } };
  const blank = generationBase(emptyProject(), 'image', context, image);
  assert.deepEqual(blank.canvas, { width: 375, height: 667, preset: 'custom' });
  assert.equal(blank.frame.style, 'none'); assert.equal(blank.safeArea.enabled, false);
  const result = parseGenerationResponse(reply([
    { op: 'canvas', fields: { background: '#f8fafc' } },
    { op: 'add', item: heading }, { op: 'add', item: { ...button, name: '' } },
    { op: 'add', item: { ...button, id: 'second', name: '', y: 200 } },
  ]), blank, 'image', clean, { designContext: context });
  assert.deepEqual(result.project.items.map(item => item.name), ['登录标题', '登录 · 按钮', '登录 · 按钮 2']);
  assert.equal(result.project.items[0].content, '<h1>欢迎登录</h1>');
  assert.equal(result.project.items[0].x, 20); assert.equal(result.project.items[0].radius, 0);
  assert.equal(result.project.items[0].imported, true);
  assert.equal(result.project.safeArea.enabled, false);
  assert.equal(result.project.canvas.background, '#f8fafc');
  assert.equal(result.project.canvas.width, 375);
  assert.equal(nameImageComponents([{ ...button, name: '重复' }, { ...button, name: '重复' }])[1].name, '重复 2');
});
test('模型重复返回参考尺寸、默认预设或其他尺寸时保留本地参考画布及组件坐标', () => {
  const valid = [{ op: 'add', item: heading }, { op: 'add', item: button }];
  for (const canvasFields of [
    { width: 375, height: 667, background: '#f8fafc' },
    { width: 375, height: 667, preset: 'phone', background: '#f8fafc' },
    { width: 1280, height: 800, preset: 'pc', background: '#f8fafc' },
    { width: 800 },
    { preset: 'phone' },
  ]) {
    // 放在新增组件之后，确保处理顺序不会改变组件位置。
    const result = parseGenerationResponse(reply([...valid, { op: 'canvas', fields: canvasFields }]), base(), 'image', clean);
    assert.equal(result.project.canvas.width, 375); assert.equal(result.project.canvas.height, 667);
    assert.equal(result.project.canvas.preset, 'custom');
    assert.deepEqual(result.project.items.map(({ x, y, width, height }) => ({ x, y, width, height })), [heading, button].map(({ x, y, width, height }) => ({ x, y, width, height })));
    if (canvasFields.background) assert.equal(result.project.canvas.background, '#f8fafc');
  }
  for (const canvasFields of [{ width: '375' }, { height: null }, { unknown: true }, {}]) {
    assert.throws(() => parseGenerationResponse(reply([...valid, { op: 'canvas', fields: canvasFields }]), base(), 'image', clean));
  }
});
test('图片组件轻微越界、负坐标及过大尺寸自动约束到参考画布，保留其他组件和内容', () => {
  for (const [geometry, expected] of [
    [{ x: 200, y: 150, width: 200, height: 40 }, { x: 175, y: 150, width: 200, height: 40 }],
    [{ x: -0.25, y: -12, width: 200, height: 40 }, { x: 0, y: 0, width: 200, height: 40 }],
    [{ x: 900, y: 1000, width: 200, height: 40 }, { x: 175, y: 627, width: 200, height: 40 }],
    [{ x: 10, y: 20, width: 1280, height: 800 }, { x: 0, y: 0, width: 375, height: 667 }],
    [{ x: 0, y: 0, width: 0.2, height: 0.4 }, { x: 0, y: 0, width: 1, height: 1 }],
    [{ x: 175.2, y: 627.2, width: 200, height: 40 }, { x: 175, y: 627, width: 200, height: 40 }],
  ]) {
    const result = parseGenerationResponse(reply([{ op: 'add', item: heading }, { op: 'add', item: { ...button, ...geometry } }]), base(), 'image', clean);
    const fitted = result.project.items[1];
    assert.deepEqual({ x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height }, expected);
    assert.equal(fitted.content, button.content); assert.equal(fitted.name, button.name);
    assert.equal(result.project.items[0].x, heading.x); assert.equal(result.project.items[0].y, heading.y);
    assert.equal(result.project.canvas.width, 375); assert.equal(result.project.canvas.height, 667);
  }
});
test('图片生成拒绝无效坐标、缺少尺寸、零或负宽高', () => {
  for (const geometry of [{ x: null }, { y: '150' }, { x: undefined }, { width: 0 }, { height: -1 }, { width: undefined }, { height: null }, { x: 1e400 }]) {
    assert.throws(() => parseGenerationResponse(reply([{ op: 'add', item: heading }, { op: 'add', item: { ...button, ...geometry } }]), base(), 'image', clean), /有效数字/);
  }
});
test('拒绝单层整图、设备外框或安全区、引用组件库和跨页动作', () => {
  const valid = [{ op: 'add', item: heading }, { op: 'add', item: button }];
  for (const changes of [valid.slice(0, 1), [...valid, { op: 'frame', fields: { style: 'browser' } }], [...valid, { op: 'safeArea', fields: { enabled: true } }], [valid[0], { op: 'add', item: { ...button, libraryId: 'existing' } }], [valid[0], { op: 'add', item: { ...button, interaction: { type: 'navigate', targetId: 'home' } } }]]) {
    assert.throws(() => parseGenerationResponse(reply(changes), base(), 'image', clean));
  }
});
test('视觉请求发送多模态图片与尺寸，隔离历史和工程清单，其他模式按需携带图片', async () => {
  let sent;
  const fetcher = async (_, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: reply([]) } }] }) }; };
  const settings = { url: 'https://example.com/v1', model: 'vision' };
  await requestAI(settings, '还原界面', base(), [{ role: 'user', content: '之前的需求' }], undefined, fetcher, { mode: 'image', referenceImage: image, designContext: { private: '关联清单' } });
  assert.equal(sent.messages.length, 2);
  assert.match(sent.messages[0].content, /禁止将整张截图/);
  const content = sent.messages[1].content;
  assert.equal(content[1].image_url.url, image.dataURL); assert.equal(content[1].image_url.detail, 'high');
  const task = JSON.parse(content[0].text);
  assert.equal(task.mode, 'image'); assert.deepEqual(task.referenceImage, { width: 375, height: 667 });
  assert.equal(task.designContext, undefined); assert.equal(task.project.items.length, 0);
  await requestAI(settings, '生成页面', generationBase(emptyProject(), 'page'), [], undefined, fetcher, { mode: 'page', referenceImage: image });
  assert.equal(sent.messages[1].content[1].image_url.url, image.dataURL);
  assert.equal(JSON.parse(sent.messages[1].content[0].text).mode, 'page');
  await requestAI(settings, '生成页面', generationBase(emptyProject(), 'page'), [], undefined, fetcher, { mode: 'page' });
  assert.equal(typeof sent.messages[1].content, 'string');
  await assert.rejects(requestAI(settings, '还原界面', base(), [], undefined, async () => ({ ok: false, status: 400 }), { mode: 'image', referenceImage: image }), /视觉模型/);
});
