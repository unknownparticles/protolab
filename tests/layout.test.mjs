import test from 'node:test';
import assert from 'node:assert/strict';
import { alignItems, moveItems, selectionBounds } from '../src/layout.js';
import { normalizeGuides, rulerMarkup } from '../src/guides.js';
import { createHistory } from '../src/model.js';
const project = { canvas: { width: 375, height: 667 }, items: [
  { id: 'a', x: 20, y: 30, width: 100, height: 40 },
  { id: 'b', x: 180, y: 200, width: 60, height: 80 },
  { id: 'c', x: 5, y: 5, width: 20, height: 20 },
] };
const ids = new Set(['a', 'b']);
test('画布对齐支持不同尺寸组件及奇数尺寸居中，保留未选组件和原始状态', () => {
  const center = alignItems(project, ids, 'center');
  assert.deepEqual(center.items.map(({ x, y }) => [x, y]), [[138, 314], [158, 294], [5, 5]]);
  assert.deepEqual(alignItems(project, ids, 'left').items.slice(0, 2).map(item => item.x), [0, 0]);
  assert.deepEqual(alignItems(project, ids, 'right').items.slice(0, 2).map(item => item.x), [275, 315]);
  assert.deepEqual(alignItems(project, ids, 'top').items.slice(0, 2).map(item => item.y), [0, 0]);
  assert.deepEqual(alignItems(project, ids, 'bottom').items.slice(0, 2).map(item => item.y), [627, 587]);
  assert.deepEqual(alignItems(project, ids, 'centerX').items.slice(0, 2).map(item => item.y), [30, 200]);
  assert.deepEqual(alignItems(project, ids, 'centerY').items.slice(0, 2).map(item => item.x), [20, 180]);
  assert.equal(project.items[0].x, 20);
});
test('多选对齐以所选组件包围框为参照，单选不执行互相对齐', () => {
  assert.deepEqual(selectionBounds(project.items.slice(0, 2)), { x: 20, y: 30, width: 220, height: 250 });
  const positions = { left: [[20, 30], [20, 200]], right: [[140, 30], [180, 200]],
    top: [[20, 30], [180, 30]], bottom: [[20, 240], [180, 200]],
    centerX: [[80, 30], [100, 200]], centerY: [[20, 135], [180, 115]], center: [[80, 135], [100, 115]] };
  for (const [direction, expected] of Object.entries(positions)) {
    assert.deepEqual(alignItems(project, ids, direction, 'selection').items.slice(0, 2).map(({ x, y }) => [x, y]), expected);
  }
  assert.equal(alignItems(project, new Set(['a']), 'center', 'selection'), project);
  assert.equal(alignItems(project, new Set(), 'center'), project);
});
test('整组移动保留间距，越界时统一限制，取消拖动可恢复起点', () => {
  const starts = new Map(project.items.slice(0, 2).map(item => [item.id, { x: item.x, y: item.y }]));
  const moved = moveItems(project, starts, 999, -999);
  assert.deepEqual(moved.items.map(({ x, y }) => [x, y]), [[155, 0], [315, 170], [5, 5]]);
  assert.deepEqual(moveItems(moved, starts, 0, 0), project);
  assert.equal(moveItems(project, new Map(), 1, 1), project);
});
test('对齐作为单次历史操作撤销重做', () => {
  const history = createHistory(project);
  const aligned = alignItems(project, ids, 'center'); history.push(aligned);
  assert.deepEqual(history.undo(), project); assert.deepEqual(history.redo(), aligned);
});
test('辅助线设置恢复有默认值，标尺标签在不同缩放下仍使用实际像素', () => {
  assert.deepEqual(normalizeGuides(null), { rulers: true, grid: false, gridSize: 20 });
  assert.deepEqual(normalizeGuides({ rulers: false, grid: true, gridSize: 50 }), { rulers: false, grid: true, gridSize: 50 });
  assert.equal(normalizeGuides({ gridSize: -5 }).gridSize, 20);
  assert.match(rulerMarkup(375, .5), /width="187.5"/);
  assert.match(rulerMarkup(375, .5), /x="53" y="10">100<\/text>/);
  assert.match(rulerMarkup(667, 2, true), /height="1334"/);
  assert.match(rulerMarkup(667, 2, true), /translate\(9 103\).*?>50<\/text>/);
});
