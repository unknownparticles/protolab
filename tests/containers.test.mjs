import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTAINERS, containerLayout } from '../src/containers.js';
import { createItem, constrainProject, validateProject } from '../src/model.js';
import { copyItems, withPages } from '../src/pages.js';
import { visibilityLayout } from '../src/visibility.js';
import { exportHTML } from '../src/content.js';

const canvas = { width: 600, height: 600, preset: 'custom' };
function board(mode = 'vertical') {
  const parent = { ...createItem(CONTAINERS.find(item => item.container.mode === mode), canvas, 20, 30), id: 'parent', width: 300, height: 260 };
  const children = Array.from({ length: 4 }, (_, index) => ({ ...createItem({ name: `项目${index}`, type: 'html', content: '<button>测试</button>', defaultWidth: 80, defaultHeight: 40 }, canvas), id: `child-${index}`, parentId: parent.id, layoutBasis: { width: 80, height: 40 } }));
  return constrainProject({ version: 1, canvas, items: [parent, ...children] });
}
test('纵向与横向容器按留白和间距排列，网格按列数换行', () => {
  const vertical = board().items.slice(1);
  assert.deepEqual(vertical.map(item => [item.x, item.y, item.width, item.height]), [[36,46,268,40],[36,98,268,40],[36,150,268,40],[36,202,268,40]]);
  const horizontal = board('horizontal').items.slice(1);
  assert.equal(horizontal[0].y, 46); assert.equal(horizontal[0].height, 228);
  assert.equal(horizontal[1].x - horizontal[0].x, horizontal[0].width + 12);
  assert.equal(horizontal.at(-1).x + horizontal.at(-1).width, 304);
  const grid = board('grid').items.slice(1);
  assert.deepEqual(grid.map(item => [item.x,item.y,item.width,item.height]), [[36,46,128,108],[176,46,128,108],[36,166,128,108],[176,166,128,108]]);
  assert.equal(containerLayout(board('grid').items.slice(0, 2))[1].width, 128);
});
test('移动和反复缩放容器保留首选尺寸，极小容器也不会溢出', () => {
  const original = board();
  const small = constrainProject({ ...original, items: original.items.map(item => item.container ? { ...item, x: 100, y: 100, width: 40, height: 40 } : item) });
  const parent = small.items[0];
  for (const item of small.items.slice(1)) {
    assert.ok(item.width > 0 && item.height > 0);
    assert.ok(item.x >= parent.x && item.y >= parent.y);
    assert.ok(item.x + item.width <= parent.x + parent.width + 1e-8);
    assert.ok(item.y + item.height <= parent.y + parent.height + 1e-8);
  }
  const restored = constrainProject({ ...small, items: small.items.map(item => item.container ? original.items[0] : item) });
  assert.deepEqual(restored.items, original.items);
  assert.deepEqual(containerLayout(original.items), original.items);
});
test('隐藏子项仅收起所属容器的空间，重复投影不修改保存基线', () => {
  const value = board('grid'); value.items[1].visible = false;
  const next = visibilityLayout(value.items);
  assert.equal(next[2].x, 36); assert.equal(next[2].y, 46);
  assert.equal(value.items[2].x, 176);
  assert.deepEqual(visibilityLayout(value.items), next);
  value.items[1].collapseSpace = false;
  assert.equal(visibilityLayout(value.items)[2].x, 176);
});
test('容器保存恢复和整组复制保持关联，拒绝缺失父容器与循环嵌套', () => {
  const value = withPages(validateProject(board(), content => content));
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(value)), content => content), value);
  const copied = copyItems(value.items);
  assert.ok(copied.slice(1).every(item => item.parentId === copied[0].id));
  assert.equal(copyItems([value.items[1]])[0].parentId, 'parent');
  assert.throws(() => validateProject({ ...board(), items: board().items.slice(1) }, content => content), /容器/);
  const nested = board(); nested.items[0].parentId = 'parent';
  assert.throws(() => validateProject(nested, content => content), /嵌套/);
  const html = exportHTML(value);
  assert.match(html, /data-container=/); assert.match(html, /data-parent-id="parent"/);
  assert.match(html, /function containerLayout/);
});
