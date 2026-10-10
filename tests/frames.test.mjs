import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFrame, frameLayout, FRAME_STYLES } from '../src/frames.js';
import { validateProject, resizeProject, createHistory } from '../src/model.js';
import { deviceMarkup, exportHTML, itemHTML } from '../src/content.js';

const canvas = { width: 375, height: 667, preset: 'phone' };
test('所有设备外框都包围实际画布，关闭外框还原画布尺寸', () => {
  for (const [device, styles] of Object.entries(FRAME_STYLES)) {
    for (const style of Object.keys(styles)) {
      const frame = normalizeFrame({ style }, device);
      const layout = frameLayout(canvas, frame);
      assert.equal(layout.width, canvas.width + layout.left + layout.right);
      assert.equal(layout.height, canvas.height + layout.top + layout.bottom);
      assert.ok(layout.width > canvas.width);
    }
  }
  assert.equal(frameLayout(canvas, normalizeFrame({ style: 'none' })).width, 375);
});
test('旧草稿补充外框配置，非法外框内容被拒绝', () => {
  const project = validateProject({ version: 1, canvas, items: [] }, value => value);
  assert.equal(project.frame.device, 'phone');
  assert.equal(project.frame.statusBar, false);
  for (const frame of ['invalid', { html: 42 }, { html: 'x'.repeat(100_001) }]) {
    assert.throws(() => validateProject({ version: 1, canvas, frame, items: [] }, value => value));
  }
  const safe = validateProject({ version: 1, canvas, frame: { html: '<div>清理</div>' }, items: [] }, () => '已清理');
  assert.equal(safe.frame.html, '已清理');
});
test('切换设备保留系统栏和自定义内容，旋转保留留白', () => {
  const project = { version: 1, canvas, items: [], frame: normalizeFrame({ style: 'custom', html: '<div>外框</div>', statusBar: true, navigation: 'buttons', insets: { top: 30, right: 20, bottom: 40, left: 10 } }) };
  const tablet = resizeProject(project, 768, 1024, 'tablet');
  assert.equal(tablet.frame.device, 'tablet');
  assert.equal(tablet.frame.style, 'custom');
  assert.equal(tablet.frame.navigation, 'buttons');
  const rotated = resizeProject(tablet, 1024, 768, 'tablet');
  assert.deepEqual(frameLayout(rotated.canvas, rotated.frame), { top: 30, right: 20, bottom: 40, left: 10, width: 1054, height: 838 });
  const pc = normalizeFrame({ style: 'classic' }, 'pc');
  assert.equal(pc.style, 'monitor');
});
test('时间、电量及留白有边界，系统栏仅在手机和平板绘制', () => {
  const frame = normalizeFrame({ time: '25:99', battery: 200, insets: { top: -10, right: 999 }, statusBar: true, navigation: 'buttons' });
  assert.equal(frame.time, '9:41'); assert.equal(frame.battery, 100);
  assert.equal(frame.insets.top, 0); assert.equal(frame.insets.right, 200);
  const phone = deviceMarkup(canvas, frame).inner;
  assert.match(phone, /device-status/); assert.match(phone, /device-navigation buttons/);
  const pc = deviceMarkup(canvas, normalizeFrame(frame, 'pc')).inner;
  assert.doesNotMatch(pc, /device-status|device-navigation/);
});
test('外框与系统栏纳入历史，导出保持画布坐标和完整外框', () => {
  const original = { version: 1, canvas, items: [], frame: normalizeFrame() };
  const changed = { ...original, frame: normalizeFrame({ style: 'custom', html: '<div>蓝色外框</div>', statusBar: true, time: '12:34', battery: 0, navigation: 'gesture' }) };
  const history = createHistory(original); history.push(changed);
  assert.equal(history.undo().frame.style, 'modern');
  assert.equal(history.redo().frame.battery, 0);
  const html = exportHTML(changed);
  assert.match(html, /width:423px;height:715px/);
  assert.match(html, /width:375px;height:667px/);
  assert.match(html, /蓝色外框/); assert.match(html, /12:34/); assert.match(html, /<span>0%<\/span>/);
});
test('矢量图形使用透明底且零圆角，避免点线被白色卡片遮挡', () => {
  assert.match(itemHTML({ type: 'svg', name: '线', content: '<svg></svg>', x: 0, y: 0, width: 100, height: 12, radius: 0, padding: '0', margin: '0' }), /prototype-item vector-item/);
});
