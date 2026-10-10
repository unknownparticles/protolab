import test from 'node:test';
import assert from 'node:assert/strict';
import { resizePreviewItem } from '../src/preview-resize.js';

const start = { x: 40, y: 50, width: 100, height: 80 };
const bounds = { x: 10, y: 20, width: 300, height: 240 };
test('预览缩放固定对边，角点同时改变宽高，限制最小尺寸与安全区', () => {
  assert.deepEqual(resizePreviewItem(start, 'se', 30, 20, bounds), { ...start, width: 130, height: 100 });
  assert.deepEqual(resizePreviewItem(start, 'nw', 20, 10, bounds), { x: 60, y: 60, width: 80, height: 70 });
  assert.deepEqual(resizePreviewItem(start, 'nw', -1000, -1000, bounds), { x: 10, y: 20, width: 130, height: 110 });
  assert.deepEqual(resizePreviewItem(start, 'se', 1000, 1000, bounds), { ...start, width: 270, height: 210 });
  assert.deepEqual(resizePreviewItem(start, 'se', -1000, -1000, bounds), { ...start, width: 1, height: 1 });
  assert.deepEqual(resizePreviewItem(start, 'e', 20, 100, bounds), { ...start, width: 120 });
});
test('旋转组件按局部方向缩放并保留对边的屏幕位置', () => {
  const next = resizePreviewItem(start, 'e', 0, 20, bounds, 90);
  assert.deepEqual(next, { x: 30, y: 60, width: 120, height: 80 });
  assert.equal(next.x + next.width / 2, start.x + start.width / 2);
  assert.equal(next.y + next.height / 2 - next.width / 2, start.y + start.height / 2 - start.width / 2);
});
