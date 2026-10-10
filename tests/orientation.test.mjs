import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainProject, rotateProject, resizeProject, validateProject, validateLibrary, createItem, createHistory } from '../src/model.js';
import { normalizeOrientationResponse, orientationPresentation } from '../src/orientation.js';
import { exportHTML } from '../src/content.js';
import { parseAIResponse } from '../src/ai.js';
import { createVersions, validateWorkspace } from '../src/versions.js';
import { snapItems } from '../src/snapping.js';

const clean = value => value;
const item = { id: 'edge', name: '底部卡片', type: 'html', content: '<div>卡片</div>', x: 24, y: 600, width: 300, height: 50, radius: 8, padding: '0', margin: '0' };
const base = () => validateProject({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, items: [item, { ...item, id: 'upper', y: 80, height: 400 }] }, clean);
const response = { enabled: true, portrait: 'hide', landscape: 'rotate90' };

test('方向切换保留边缘、大尺寸组件和间距，多次切换不累积变化', () => {
  const initial = base();
  let project = initial;
  for (let index = 0; index < 6; index++) {
    project = constrainProject(rotateProject(project));
    assert.deepEqual(project.items, initial.items);
  }
  assert.deepEqual([project.canvas.width, project.canvas.height, project.canvas.preset], [375, 667, 'phone']);
  assert.deepEqual(initial, base());
});

test('安全区和系统栏在新方向变化时不推动已有组件', () => {
  const initial = validateProject({ ...base(), frame: { device: 'phone', style: 'modern', statusBar: true, camera: 'island' },
    safeArea: { enabled: true, left: 20, right: 20, top: 10, bottom: 10 }, items: [{ ...item, y: 54 }] }, clean);
  const rotated = rotateProject(initial);
  assert.deepEqual(rotated.items, initial.items);
  assert.deepEqual(validateProject(rotated, clean).items, initial.items);
});

test('刷新、草稿导入和版本备份保留横屏中被裁切的原始布局', () => {
  const initial = base();
  const rotated = rotateProject(initial);
  rotated.items[0].orientationResponse = response;
  const recovered = validateProject(JSON.parse(JSON.stringify(rotated)), clean);
  assert.deepEqual(recovered, rotated);
  const history = createHistory(initial); history.push(rotated);
  assert.deepEqual(history.undo(), initial); assert.deepEqual(history.redo(), rotated);
  const versions = createVersions(initial); versions.add(rotated, '切换方向');
  const workspace = validateWorkspace({ version: 1, versions: versions.serialize(), messages: [], pending: null }, value => validateProject(value, clean));
  assert.deepEqual(createVersions(initial, workspace.versions).current, rotated);
});

test('手动缩小画布或重新应用安全区继续约束组件', () => {
  const rotated = rotateProject(base());
  const resized = resizeProject(rotated, 100, 100);
  assert.equal(resized.canvas.layoutSize, undefined);
  assert.deepEqual([resized.items[0].x, resized.items[0].y, resized.items[0].width], [0, 50, 100]);
  const fitted = constrainProject(rotated, true);
  assert.equal(fitted.items[0].y, 325);
  assert.equal(fitted.canvas.layoutSize, undefined);
});

test('组件响应按当前方向计算，关闭后恢复，旋转不累积且不修改几何', () => {
  const responsive = { ...item, orientationResponse: response };
  assert.deepEqual(orientationPresentation(responsive, { width: 375, height: 667 }), { hidden: true, angle: 0 });
  assert.deepEqual(orientationPresentation(responsive, { width: 667, height: 375 }), { hidden: false, angle: 90 });
  for (const [action, angle] of [['none', 0], ['rotate90', 90], ['rotate180', 180], ['rotate270', -90]]) {
    assert.deepEqual(orientationPresentation({ ...item, orientationResponse: { enabled: true, landscape: action } }, { width: 667, height: 375 }), { hidden: false, angle });
  }
  assert.deepEqual(orientationPresentation({ ...responsive, orientationResponse: { ...response, enabled: false } }, { width: 375, height: 667 }), { hidden: false, angle: 0 });
  assert.deepEqual(responsive, { ...item, orientationResponse: response });
});

test('旧组件默认关闭响应，自定义组件库往返并由实例继承', () => {
  const component = { id: 'card', name: '卡片', type: 'html', content: '<div>卡片</div>', defaultWidth: 120, defaultHeight: 60, orientationResponse: response };
  const library = validateLibrary([component], clean);
  assert.deepEqual(validateLibrary({ version: 1, components: library }, clean), library);
  const instance = createItem(library[0], base().canvas);
  assert.deepEqual(instance.orientationResponse, response);
  instance.orientationResponse.landscape = 'hide';
  assert.equal(library[0].orientationResponse.landscape, 'rotate90');
  assert.equal(normalizeOrientationResponse().enabled, false);
  assert.equal(base().items[0].orientationResponse.enabled, false);
});

test('预览及导出应用当前方向的响应，并保留原工程数据', () => {
  const project = rotateProject(base());
  project.items[0].orientationResponse = response;
  project.items[1].orientationResponse = normalizeOrientationResponse({ enabled: true, landscape: 'hide' });
  const html = exportHTML(project);
  assert.match(html, /top:600px;.*?transform:rotate\(90deg\)/);
  assert.match(html, /data-element-id="upper"[^>]*data-orientation-hidden="true" hidden[^>]*top:80px/);
  const recovered = validateProject(JSON.parse(html.match(/id="protolab-project">(.*?)<\/script>/s)[1]), clean);
  assert.deepEqual(recovered, project);
});

test('导入拒绝非法方向动作、错误配置和伪造设计范围', () => {
  for (const raw of ['hide', [], { portrait: 'scale' }, { landscape: 'constructor' }, { landscape: ['hide'] }]) assert.throws(() => normalizeOrientationResponse(raw));
  assert.throws(() => validateProject({ ...base(), canvas: { ...base().canvas, layoutSize: { width: 2000, height: 2000 } } }, clean));
  assert.throws(() => validateProject({ ...base(), items: [{ ...item, orientationResponse: { landscape: 'alert(1)' } }] }, clean));
});

test('智能修改可设置方向响应，保留原布局并正确处理手动调整画布', () => {
  const rotated = rotateProject(base());
  const reply = changes => JSON.stringify({ version: 1, summary: '设置方向响应', changes });
  const next = parseAIResponse(reply([{ op: 'update', id: 'edge', fields: { orientationResponse: response } }]), rotated, clean).project;
  assert.equal(next.items[0].y, 600);
  assert.deepEqual(next.items[0].orientationResponse, response);
  const resized = parseAIResponse(reply([{ op: 'canvas', fields: { width: 200, height: 200 } }]), next, clean).project;
  assert.equal(resized.canvas.layoutSize, undefined);
  assert.equal(resized.items[0].y, 150);
  assert.throws(() => parseAIResponse(reply([{ op: 'update', id: 'edge', fields: { orientationResponse: { enabled: 'yes' } } }]), rotated, clean));
});

test('拖动时不吸附当前方向隐藏的组件', () => {
  const project = { ...base(), items: [{ ...item, id: 'moving', x: 20, y: 30, width: 40, height: 40 },
    { ...item, id: 'hidden', x: 130, y: 130, width: 40, height: 40, orientationResponse: response }] };
  const starts = new Map([['moving', { x: 20, y: 30 }]]);
  assert.equal(snapItems(project, starts, 65, 0).project.items[0].x, 85);
  project.items[1].orientationResponse = { ...response, enabled: false };
  assert.equal(snapItems(project, starts, 65, 0).project.items[0].x, 90);
});
