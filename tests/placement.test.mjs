import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFrame } from '../src/frames.js';
import { normalizeSafeArea, placementBounds } from '../src/safe-area.js';
import { constrainProject, createItem, resizeProject, validateProject, createHistory } from '../src/model.js';
import { alignItems, moveItems } from '../src/layout.js';
import { snapItems } from '../src/snapping.js';
import { exportHTML } from '../src/content.js';
const item = { id: 'a', type: 'html', content: '<div>卡片</div>', name: '卡片', x: 20, y: 80, width: 100, height: 40, radius: 8, padding: '0', margin: '0' };
const base = { version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, frame: normalizeFrame(), items: [item] };
const safe = constrainProject({ ...base, frame: normalizeFrame({ statusBar: true, navigation: 'buttons' }), safeArea: { enabled: true, top: 16, bottom: 20, left: 24, right: 36 } });
const starts = project => new Map(project.items.map(value => [value.id, { x: value.x, y: value.y }]));
test('安全区从系统栏内侧计算，关闭限制和电脑系统栏不占空间', () => {
  assert.deepEqual(placementBounds(safe), { x: 24, y: 44, width: 315, height: 563 });
  assert.deepEqual(placementBounds({ ...safe, frame: normalizeFrame({ device: 'pc' }, 'custom') }), { x: 24, y: 16, width: 315, height: 631 });
  assert.deepEqual(placementBounds({ ...safe, safeArea: { enabled: false } }), { x: 0, y: 0, width: 375, height: 667 });
  assert.equal(placementBounds({ ...safe, frame: normalizeFrame({ statusBar: true, navigation: 'gesture' }) }).height, 575);
  assert.equal(placementBounds({ ...safe, frame: normalizeFrame({ statusBar: true, navigation: 'buttons', camera: 'island' }) }).y, 60);
});
test('新增、属性约束、对齐及移动都不能进入留白', () => {
  const bounds = placementBounds(safe);
  const added = createItem({ name: '大组件', type: 'html', content: '<div></div>', defaultWidth: 999, defaultHeight: 999 }, base.canvas, -99, 9999, bounds);
  assert.deepEqual([added.x, added.y, added.width, added.height], [24, 44, 315, 563]);
  const ids = new Set(['a']);
  assert.deepEqual(alignItems(safe, ids, 'center').items.map(({ x, y }) => [x, y]), [[132, 306]]);
  assert.deepEqual(alignItems(safe, ids, 'bottom').items.map(({ x, y }) => [x, y]), [[24, 567]]);
  assert.deepEqual(moveItems(safe, starts(safe), -999, 999).items.map(({ x, y }) => [x, y]), [[24, 567]]);
});
test('多选移动受安全区限制并保留组件之间的距离', () => {
  const group = constrainProject({ ...safe, items: [item, { ...item, id: 'b', x: 180, y: 200, width: 60, height: 80 }] });
  const moved = moveItems(group, starts(group), 999, -999);
  assert.deepEqual(moved.items.map(({ x, y }) => [x, y]), [[123, 44], [279, 164]]);
  assert.deepEqual(moveItems(moved, starts(group), 0, 0), group);
});
test('缩小或旋转画布时留白收缩且至少保留一像素可用区域', () => {
  const largeInsets = { ...safe, safeArea: { enabled: true, left: 200, right: 200, top: 400, bottom: 400 } };
  const resized = resizeProject(largeInsets, 100, 100);
  const bounds = placementBounds(resized);
  assert.equal(bounds.width, 1); assert.equal(bounds.height, 1);
  assert.deepEqual([resized.items[0].width, resized.items[0].height, resized.items[0].x, resized.items[0].y], [1, 1, bounds.x, bounds.y]);
  assert.throws(() => normalizeSafeArea('invalid', base.canvas, base.frame));
});
test('草稿恢复安全区并修正越界内容，设置及位置一起撤销重做，导出保持最终位置', () => {
  const recovered = validateProject({ ...safe, items: [{ ...item, x: 0, y: 0 }] }, value => value);
  assert.deepEqual([recovered.items[0].x, recovered.items[0].y], [24, 44]);
  const history = createHistory(base); history.push(recovered);
  assert.deepEqual(history.undo(), base); assert.deepEqual(history.redo(), recovered);
  const html = exportHTML(recovered);
  assert.match(html, /left:24px;top:44px/);
  assert.doesNotMatch(html, /canvas-safe-area|canvas-snap-guides/);
  assert.equal(validateProject(base, value => value).safeArea.enabled, false);
});
test('居中吸附按屏幕距离计算，关闭或临时跳过时自由移动', () => {
  const snapped = snapItems(base, starts(base), 113, 0);
  assert.equal(snapped.project.items[0].x, 138);
  assert.ok(snapped.guides.some(guide => guide.axis === 'x' && guide.position === 187.5));
  assert.equal(snapItems(base, starts(base), 113, 0, 1, false).project.items[0].x, 133);
  assert.equal(snapItems(base, starts(base), 106, 0, .5).project.items[0].x, 138);
  assert.equal(snapItems(base, starts(base), 106, 0, 2).project.items[0].x, 126);
});
test('吸附其他组件边缘及中心，多选整体吸附且不能突破安全区', () => {
  const project = { ...base, items: [item, { ...item, id: 'b', x: 250, y: 300, width: 60, height: 80 }] };
  const moving = new Map([['a', { x: item.x, y: item.y }]]);
  const snapped = snapItems(project, moving, 130, 216);
  assert.deepEqual(snapped.project.items.map(({ x, y }) => [x, y]), [[150, 300], [250, 300]]);
  assert.ok(snapped.guides.some(guide => guide.position === 250));
  const group = { ...base, items: [item, { ...item, id: 'b', x: 130, y: 120 }] };
  const centered = snapItems(group, starts(group), 63, 0);
  assert.deepEqual(centered.project.items.map(value => value.x), [83, 193]);
  const edge = snapItems(safe, starts(safe), -999, -999);
  assert.deepEqual([edge.project.items[0].x, edge.project.items[0].y], [24, 44]);
  assert.deepEqual(snapItems(base, new Map(), 1, 1), { project: base, guides: [] });
});
