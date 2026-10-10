import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, normalizeItem, resizeProject, createItem, validateLibrary, validateProject, createHistory, clientToCanvas, spacing } from '../src/model.js';
import { COMPONENTS } from '../src/presets.js';
const canvas = { width: 375, height: 667, preset: 'phone' };
const sanitize = value => value;
const item = { id: 'one', name: '按钮', type: 'html', content: '<button>按钮</button>', x: 20, y: 30, width: 100, height: 40, radius: 8, padding: '0', margin: '0' };
test('七个基础组件具有有效内容及独立标识', () => {
  assert.equal(COMPONENTS.length, 7);
  assert.equal(new Set(COMPONENTS.map(value => value.id)).size, 7);
  assert.equal(validateLibrary(COMPONENTS, sanitize).length, 7);
});
test('零坐标与零圆角不被默认值覆盖', () => {
  const value = normalizeItem({ ...item, x: 0, y: 0, radius: 0 }, canvas);
  assert.equal(value.x, 0); assert.equal(value.y, 0); assert.equal(value.radius, 0);
  const added = createItem(COMPONENTS[0], canvas, 0, 0);
  assert.equal(added.x, 0); assert.equal(added.y, 0);
});
test('超出画布的组件尺寸及坐标都被约束为非负值', () => {
  const value = normalizeItem({ ...item, width: 5000, height: 5000, x: -50, y: 9999 }, canvas);
  assert.deepEqual([value.width, value.height, value.x, value.y], [375, 667, 0, 0]);
});
test('自定义尺寸范围与缩小后的组件边界', () => {
  const project = resizeProject({ items: [{ ...item, x: 300, y: 600 }] }, 100, 100);
  assert.deepEqual([project.items[0].x, project.items[0].y], [0, 60]);
  assert.equal(resizeProject(project, 9999, -1).canvas.width, 2000);
  assert.equal(resizeProject(project, 9999, -1).canvas.height, 100);
});
test('任意自定义画布旋转两次还原', () => {
  let project = resizeProject({ items: [] }, 432, 876);
  project = resizeProject(project, project.canvas.height, project.canvas.width);
  project = resizeProject(project, project.canvas.height, project.canvas.width);
  assert.deepEqual(project.canvas, { width: 432, height: 876, preset: 'custom' });
  assert.equal(PRESETS.pc.width > PRESETS.pc.height, true);
});
test('缩放后的放置坐标使用真实像素', () => {
  assert.deepEqual(clientToCanvas(150, 175, { left: 100, top: 100 }, .5), { x: 100, y: 150 });
  assert.deepEqual(clientToCanvas(300, 400, { left: 100, top: 100 }, 2), { x: 100, y: 150 });
});
test('边距验证拒绝样式注入及负数', () => {
  assert.equal(spacing(' 8px   12px '), '8px 12px');
  for (const value of ['-1px', '0;position:fixed', 'auto', 'var(--a)', '500px', '1px 2px 3px 4px 5px']) assert.throws(() => spacing(value));
});
test('兼容旧组件库数组和版本化组件库', () => {
  const legacy = [{ id: 'old', name: '旧组件', type: 'custom', html: '<div>旧组件</div>', defaultWidth: 100, defaultHeight: 80 }];
  const migrated = validateLibrary(legacy, sanitize);
  assert.equal(migrated[0].type, 'html'); assert.equal(migrated[0].content, '<div>旧组件</div>');
  assert.deepEqual(validateLibrary({ version: 1, components: migrated }, sanitize), migrated);
  assert.deepEqual(validateLibrary([], sanitize), []);
});
test('非法导入不会通过验证', () => {
  assert.throws(() => validateLibrary({ version: 2, components: [] }, sanitize));
  assert.throws(() => validateLibrary([{ name: '无内容' }], sanitize));
  assert.throws(() => validateLibrary([{ name: '', html: 'x' }], sanitize));
  assert.throws(() => validateLibrary(Array.from({ length: 201 }, () => COMPONENTS[0]), sanitize));
  assert.throws(() => validateLibrary([COMPONENTS[0], COMPONENTS[0]], sanitize));
});
test('草稿验证重建合法尺寸、内容和边界', () => {
  const value = validateProject({ version: 1, canvas, items: [{ ...item, x: 9999 }] }, sanitize);
  assert.equal(value.items[0].x, 275);
  assert.throws(() => validateProject({ version: 1, canvas, items: [{ ...item, type: 'script' }] }, sanitize));
  assert.throws(() => validateProject({ version: 1, canvas, items: [item, item] }, sanitize));
});
test('撤销重做快照独立，分支编辑清除后续历史', () => {
  const history = createHistory({ value: 0 });
  const state = { value: 1 }; history.push(state); state.value = 99;
  history.push({ value: 2 });
  assert.deepEqual(history.undo(), { value: 1 });
  assert.deepEqual(history.redo(), { value: 2 });
  history.undo(); history.push({ value: 3 });
  assert.equal(history.canRedo, false); assert.deepEqual(history.undo(), { value: 1 });
});
test('重复状态不增加历史，历史数量有上限', () => {
  const history = createHistory({ value: 0 }, 3);
  history.push({ value: 0 }); assert.equal(history.canUndo, false);
  for (let value = 1; value < 10; value++) history.push({ value });
  assert.deepEqual(history.undo(), { value: 8 });
  assert.deepEqual(history.undo(), { value: 7 }); assert.equal(history.canUndo, false);
});
test('组件库总大小限制保证导出文件可重新导入', () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({ id: `large-${index}`, name: '大图片', type: 'image', content: 'a'.repeat(3_500_000) }));
  assert.throws(() => validateLibrary(entries, sanitize), /总大小不能超过 12 MB/);
});
