import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, spacingSides } from '../src/appearance.js';
import { normalizeItem, validateProject, validateLibrary, createItem, createHistory, contentSizeValid } from '../src/model.js';
import { exportHTML, fitSVGImages } from '../src/content.js';
const canvas = { width: 375, height: 667, preset: 'phone' };
const item = { id: 'a', name: '卡片', type: 'html', content: '<div>标题</div>', x: 10, y: 10, width: 120, height: 80, padding: '1px 2px 3px 4px', margin: '4px 3px 2px 1px' };
test('旧组件保留原始样式，四边简写正确展开', () => {
  assert.deepEqual(normalizeAppearance(), {});
  assert.deepEqual(spacingSides('0'), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(spacingSides('1px 2px'), { top: 1, right: 2, bottom: 1, left: 2 });
  assert.deepEqual(spacingSides('1px 2px 3px'), { top: 1, right: 2, bottom: 3, left: 2 });
  assert.deepEqual(spacingSides('1px 2px 3px 4px'), { top: 1, right: 2, bottom: 3, left: 4 });
  assert.equal(normalizeItem(item, canvas).appearance, undefined);
});
test('样式验证保留零透明度与小数字号，拒绝注入和非法模式', () => {
  assert.deepEqual(normalizeAppearance({ opacity: 0, fontSize: 14.5, fontWeight: 700, background: 'transparent', imageFit: 'cover', blendMode: 'multiply', unknown: 'ignored' }), { background: 'transparent', fontSize: 14.5, fontWeight: 700, opacity: 0, imageFit: 'cover', blendMode: 'multiply' });
  for (const raw of [{ background: '#fff;position:fixed' }, { textColor: 'url(secret)' }, { fontFamily: 'Arial;display:none' }, { fontSize: -1 }, { fontWeight: 901 }, { opacity: 101 }, { imageFit: 'crop' }, { blendMode: 'evil' }]) assert.throws(() => normalizeAppearance(raw));
});
test('样式、图片槽及四边间距在实例、撤销、项目验证与导出中保留', () => {
  const appearance = { background: '#112233', textColor: '#abcdef', fontFamily: 'PingFang SC, sans-serif', fontSize: 18, fontWeight: 600, opacity: 50, imageFit: 'cover', blendMode: 'multiply' };
  const component = validateLibrary([{ id: 'c', name: '自定义', type: 'html', content: item.content, imageSlot: true, appearance }], value => value)[0];
  assert.deepEqual(createItem(component, canvas).appearance, appearance);
  assert.equal(createItem(component, canvas).imageSlot, true);
  const project = validateProject({ version: 1, canvas, items: [{ ...item, appearance }] }, value => value);
  const history = createHistory(project); history.push({ ...project, items: [{ ...project.items[0], appearance: { ...appearance, opacity: 0 } }] });
  assert.deepEqual(history.undo().items[0].appearance, appearance);
  assert.equal(history.redo().items[0].appearance.opacity, 0);
  const html = exportHTML(project);
  assert.match(html, /padding:1px 2px 3px 4px/); assert.match(html, /margin:4px 3px 2px 1px/);
  assert.match(html, /--item-font-size:18px/); assert.match(html, /mix-blend-mode:multiply/); assert.match(html, /opacity:0.5/);
});
test('内嵌图片另计长度，保留标记代码与总体积限制', () => {
  const image = 'data:image/png;base64,' + 'A'.repeat(160000);
  assert.ok(contentSizeValid(`<div><img src="${image}"></div>`, 'html'));
  assert.equal(contentSizeValid('x'.repeat(100001), 'html'), false);
  assert.equal(contentSizeValid(`<img src="${image}">` + 'x'.repeat(100001), 'html'), false);
  assert.equal(contentSizeValid('x'.repeat(13 * 1024 * 1024), 'html'), false);
});

test('矢量内嵌图片分别支持拉伸、裁剪和完整显示，保留其他属性', () => {
  const content = '<svg><image width="100" height="80" href="data:image/png;base64,AA==" title="preserveAspectRatio=old > 图片" preserveAspectRatio="none"/></svg>';
  for (const [fit, aspect] of [['fill', 'none'], ['cover', 'xMidYMid slice'], ['contain', 'xMidYMid meet']]) {
    const value = fitSVGImages(content, fit);
    assert.ok(value.includes(`preserveAspectRatio="${aspect}"`));
    assert.ok(value.includes('title="preserveAspectRatio=old > 图片"'));
    assert.ok(value.includes('href="data:image/png;base64,AA=="'));
  }
});

test('透明与半透明颜色经过保存恢复导出保留，拒绝非法透明度及样式注入', async () => {
  const { colorPickerValue, colorWithRGB } = await import('../src/appearance.js');
  for (const color of ['transparent', '#1230', '#11223380', 'rgba(12, 34, 56, 0.5)']) {
    const project = validateProject({ version: 1, canvas: { ...canvas, background: color }, items: [{ ...item, appearance: { background: color, color, textColor: color }, container: { mode: 'vertical' } }] }, value => value);
    const restored = validateProject(JSON.parse(JSON.stringify(project)), value => value);
    assert.equal(restored.canvas.background, color);
    assert.equal(restored.items[0].appearance.background, color);
    assert.ok(exportHTML(restored).includes(`background:${color}`));
    assert.ok(exportHTML(restored).includes(`--item-color:${color}`));
  }
  assert.equal(colorPickerValue('#1238'), '#112233');
  assert.equal(colorPickerValue('#11223380'), '#112233');
  assert.equal(colorPickerValue('rgba(12, 34, 56, 0.5)'), '#0c2238');
  assert.equal(colorWithRGB('#1238', '#abcdef'), '#abcdef88');
  assert.equal(colorWithRGB('#11223380', '#abcdef'), '#abcdef80');
  assert.equal(colorWithRGB('rgba(12, 34, 56, 0.5)', '#abcdef'), '#abcdef80');
  assert.equal(colorWithRGB('transparent', '#abcdef'), '#abcdef');
  for (const background of ['rgba(256,0,0,0.5)', 'rgba(0,0,0,1.5)', 'rgba(0,0,0,-1)', 'rgba(0,0,0,0);position:fixed', '#12345']) assert.throws(() => normalizeAppearance({ background }));
});
