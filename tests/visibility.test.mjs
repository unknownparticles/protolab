import test from 'node:test';
import assert from 'node:assert/strict';
import { visibilityLayout, expandedY } from '../src/visibility.js';
import { alignItems } from '../src/layout.js';
import { validateProject, constrainProject, createHistory } from '../src/model.js';
import { exportHTML } from '../src/content.js';
const item = (id, y, height, extra = {}) => ({ id, name: id, type: 'html', content: '<div>内容</div>', x: 10, y, width: 200, height, ...extra });
const project = () => validateProject({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, items: [item('trigger', 20, 40), item('content', 100, 100, { visible: false }), item('footer', 240, 40)] }, value => value);

test('整块隐藏释放空间，显示后原样恢复，重复切换不积累坐标偏移', () => {
  const source = project(), baseline = structuredClone(source);
  assert.equal(visibilityLayout(source.items)[2].y, 140);
  for (let i = 0; i < 20; i++) {
    source.items[1].visible = true; assert.equal(visibilityLayout(source.items)[2].y, 240);
    source.items[1].visible = false; assert.equal(visibilityLayout(source.items)[2].y, 140);
  }
  assert.deepEqual(source, baseline);
  source.items[1].collapseSpace = false;
  assert.equal(visibilityLayout(source.items)[2].y, 240);
});

test('重叠板块只释放一次，同排可见内容与其他列保留空间', () => {
  let items = [item('card', 100, 100, { visible: false }), item('child', 120, 60, { visible: false }), item('footer', 240, 40)];
  assert.equal(visibilityLayout(items)[2].y, 140);
  items = [item('left', 100, 100, { visible: false, width: 80 }), item('right', 100, 100, { x: 110, width: 80 }), item('footer', 240, 40)];
  assert.equal(visibilityLayout(items)[2].y, 240);
  const separate = item('anotherColumn', 240, 40, { x: 250, width: 80 });
  assert.equal(visibilityLayout([items[0], separate])[1].y, 240);
});

test('属性坐标与对齐使用收起位置，保存导出、撤销重做保留展开基线', () => {
  const source = project();
  assert.equal(expandedY(source.items, 'footer', 150), 250);
  let centered = alignItems(source, new Set(['footer']), 'centerY');
  centered = constrainProject(centered);
  assert.equal(visibilityLayout(centered.items)[2].y, 314);
  const bottom = constrainProject(alignItems(source, new Set(['footer']), 'bottom'));
  assert.equal(visibilityLayout(bottom.items)[2].y, 627);
  assert.deepEqual(validateProject(bottom, value => value), bottom);
  assert.match(exportHTML(source), /data-element-id="footer"[^>]*top:140px/);
  const history = createHistory(source); history.push(bottom);
  assert.deepEqual(history.undo(), source); assert.deepEqual(history.redo(), bottom);
});

test('屏幕方向隐藏保留原布局，显隐布局配置拒绝非布尔值', () => {
  const source = project(); source.items[1].visible = true;
  source.items[1].orientationResponse = { enabled: true, portrait: 'hide', landscape: 'none' };
  assert.equal(visibilityLayout(source.items)[2].y, 240);
  source.items[1].collapseSpace = 'false';
  assert.throws(() => validateProject(source, value => value), /布尔/);
});
