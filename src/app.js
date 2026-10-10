import { PRESETS, MAX_ITEMS, MAX_LIBRARY, MAX_LIBRARY_BYTES, MAX_IMAGE, MAX_CODE, uid, clone, normalizeItem, constrainProject, resizeProject, createItem, validateLibrary, validateProject, createHistory, clientToCanvas } from './model.js';
import { COMPONENTS } from './presets.js';
import { icon, componentIcon } from './icons.js';
import { sanitizeContent, escapeHTML, itemHTML, PROTOTYPE_CSS, exportHTML, deviceMarkup } from './content.js';
import { renderComponentPreview, clearComponentPreview } from './component-preview.js';
import { FRAME_STYLES, CAMERA_STYLES, CUSTOM_FRAME_HTML, normalizeFrame, frameLayout, systemBarInsets } from './frames.js';
import { LIBRARY_KEY, PROJECT_KEY, readStorage, writeStorage, download, readFile } from './storage.js';
import { alignItems, moveItems } from './layout.js';
import { GUIDES_KEY, normalizeGuides, rulerMarkup } from './guides.js';
import { projectFile, importProjectFile } from './project-import.js';
import { normalizeSafeArea, placementBounds } from './safe-area.js';
import { snapItems } from './snapping.js';
import { createAssistant } from './assistant.js';

const $ = id => document.getElementById(id);
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
const sharedStyles = document.createElement('style');
sharedStyles.textContent = PROTOTYPE_CSS;
document.head.append(sharedStyles);
let library = clone(COMPONENTS);
let project = constrainProject({ version: 1, canvas: { ...PRESETS.phone, preset: 'phone' }, frame: normalizeFrame({ camera: 'island' }), items: [] });
let selectedId = null;
let selectedIds = new Set();
let guides = normalizeGuides();
let zoom = 1;
let gesture = null;
let saveTimer;
let toastTimer;
let customType = 'html';
let imageData = null;
let startupWarnings = [];
let initialSavedAt = null;
function completeLibrary(values) {
  const ids = new Set(COMPONENTS.map(component => component.id));
  return validateLibrary([...COMPONENTS, ...values.filter(component => !ids.has(component.id))], sanitizeContent);
}

function notify(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  $('statusMessage').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6000 : 3500);
}
function safeAction(action) {
  return async (...args) => { try { await action(...args); } catch (error) { notify(error.message || '操作失败，请重试', true); } };
}
function persistProject() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const savedAt = new Date().toISOString();
  let saved = true;
  try { assistant.persist(savedAt); } catch { saved = false; }
  try { writeStorage(PROJECT_KEY, { ...project, savedAt }); } catch { saved = false; }
  $('saveState').textContent = saved ? '已自动保存' : '草稿未保存';
  if (!saved) notify('草稿或版本未保存成功，浏览器存储不可用或已满，请导出版本备份保留设计与历史。', true);
}
function scheduleSave() {
  $('saveState').textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistProject, 300);
}
function persistLibrary() {
  try { writeStorage(LIBRARY_KEY, { version: 1, components: library }); return true; }
  catch { notify('组件库保存在内存中，浏览器存储不可用或已满。请导出 JSON 备份。', true); return false; }
}
// 恢复失败不覆盖损坏的数据，以便用户仍可手动备份。
try {
  const saved = readStorage(LIBRARY_KEY, value => validateLibrary(value, sanitizeContent));
  if (saved) library = completeLibrary(saved);
  else {
    const legacy = readStorage('proto_component_library', value => validateLibrary(value, sanitizeContent));
    if (legacy) library = completeLibrary(legacy);
  }
} catch { startupWarnings.push('组件库读取失败，已使用基础组件'); }
try {
  const saved = readStorage(PROJECT_KEY, value => { initialSavedAt = value.savedAt || null; return validateProject(value, sanitizeContent); });
  if (saved) project = saved;
} catch { startupWarnings.push('草稿读取失败，已打开空画布'); }
const assistant = createAssistant({
  initial: project, initialSavedAt, getProject: () => project, finishGesture, notify, scheduleSave,
  restoreInitial(value) { project = value; },
  applyProject(value, label) { finishGesture(); project = value; selectedId = null; selectedIds.clear(); commit(label); },
  startupWarning(message) { startupWarnings.push(message); },
});
const history = createHistory(project);
try { guides = readStorage(GUIDES_KEY, normalizeGuides) || guides; }
catch { startupWarnings.push('辅助线设置读取失败，已使用默认设置'); }
const itemNodes = new Map();
const selectedItem = () => project.items.find(item => item.id === selectedId);
const selectionStarts = () => new Map(project.items.filter(item => selectedIds.has(item.id)).map(item => [item.id, { x: item.x, y: item.y }]));

function renderLibrary() {
  const query = $('componentSearch').value.trim().toLowerCase();
  $('customList').querySelectorAll('.component-preview').forEach(clearComponentPreview);
  $('presetList').replaceChildren(); $('vectorList').replaceChildren(); $('customList').replaceChildren();
  const visible = library.filter(component => component.name.toLowerCase().includes(query));
  for (const component of visible) {
    const button = document.createElement('button');
    button.className = 'component-item'; button.draggable = true; button.type = 'button';
    button.dataset.compId = component.id;
    button.title = `添加${component.name}（${component.defaultWidth} × ${component.defaultHeight}）`;
    const symbol = component.builtin && component.type === 'svg' ? component.content : icon(componentIcon(component));
    if (component.builtin) {
      button.innerHTML = `<span class="component-symbol">${symbol}</span><span class="component-name">${escapeHTML(component.name)}</span><span class="drag-dots" aria-hidden="true">⠿</span>`;
    } else {
      button.classList.add('custom-component');
      button.innerHTML = `<span class="component-preview" aria-hidden="true"></span><span class="component-card-meta"><span class="component-name">${escapeHTML(component.name)}</span><span class="drag-dots" aria-hidden="true">⠿</span></span>`;
    }
    $(component.builtin ? component.type === 'svg' ? 'vectorList' : 'presetList' : 'customList').append(button);
    if (!component.builtin) renderComponentPreview(button.querySelector('.component-preview'), component);
  }
  const customCount = library.filter(component => !component.builtin).length;
  $('libCount').textContent = library.length;
  $('customCount').textContent = customCount;
  $('basicCount').textContent = visible.filter(component => component.builtin && component.type !== 'svg').length;
  $('vectorCount').textContent = visible.filter(component => component.builtin && component.type === 'svg').length;
  $('libraryEmpty').hidden = visible.length > 0;
  $('customEmpty').hidden = visible.some(component => !component.builtin);
  $('customEmpty').textContent = query ? '没有找到匹配的自定义组件' : '把常用的设计，变成自己的组件。';
}
function renderProperties() {
  const item = selectedItem();
  $('noSelectionMsg').hidden = !!item;
  $('selectionProps').hidden = !item;
  $('selectionCount').textContent = selectedIds.size ? `已选 ${selectedIds.size} 个` : '未选中';
  const disabled = !selectedIds.size || $('alignReference').value === 'selection' && selectedIds.size < 2;
  $('alignmentActions').querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  if (!item) return;
  $('selectionDetail').textContent = selectedIds.size > 1 ? `已选 ${selectedIds.size} 个组件，以下属性仅编辑「${item.name}」；拖动、复制、删除作用于全部所选组件。` : '按住 Shift 点击组件可多选并对齐。';
  for (const [field, key] of Object.entries({ propName: 'name', propX: 'x', propY: 'y', propW: 'width', propH: 'height', propRadius: 'radius', propPadding: 'padding', propMargin: 'margin' })) $(field).value = item[key];
}
function renderLayers() {
  $('layerList').replaceChildren();
  for (const item of [...project.items].reverse()) {
    const button = document.createElement('button');
    button.className = `layer-item${selectedIds.has(item.id) ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selectedIds.has(item.id)));
    button.dataset.itemId = item.id;
    button.innerHTML = `${icon(item.type === 'image' ? 'image' : item.type === 'svg' ? 'star' : 'layers')}<span>${escapeHTML(item.name)}</span>`;
    $('layerList').append(button);
  }
  $('layerCount').textContent = project.items.length;
  $('layerEmpty').hidden = project.items.length > 0;
  $('layerActions').hidden = !selectedItem();
  const index = project.items.findIndex(item => item.id === selectedId);
  $('layerUpBtn').disabled = index === project.items.length - 1;
  $('layerDownBtn').disabled = index <= 0;
}
function updateZoom() {
  const layout = frameLayout(project.canvas, project.frame);
  const inset = guides.rulers ? 22 : 0;
  $('canvasScaler').style.transform = `scale(${zoom})`;
  $('canvasScaler').style.left = $('canvasScaler').style.top = `${inset}px`;
  $('canvasStage').style.width = `${layout.width * zoom + inset}px`;
  $('canvasStage').style.height = `${(layout.height + 28) * zoom + inset}px`;
  renderGuides(layout);
  const existing = [...$('zoomSelect').options].find(option => Number(option.value) === zoom);
  for (const option of [...$('zoomSelect').querySelectorAll('[data-custom]')]) if (option !== existing) option.remove();
  if (!existing) { const option = new Option(`${Math.round(zoom * 100)}%`, String(zoom)); option.dataset.custom = 'true'; $('zoomSelect').add(option); }
  $('zoomSelect').value = String(zoom);
}
function renderGuides(layout) {
  $('showRulers').checked = guides.rulers; $('showGrid').checked = guides.grid;
  $('snapComponents').checked = guides.snap;
  $('gridSize').value = String(guides.gridSize);
  $('canvasGrid').hidden = !guides.grid;
  $('canvasGrid').style.setProperty('--grid-size', `${guides.gridSize}px`);
  for (const [id, vertical, length] of [['rulerHorizontal', false, project.canvas.width], ['rulerVertical', true, project.canvas.height]]) {
    const ruler = $(id); ruler.hidden = !guides.rulers;
    if (!guides.rulers) continue;
    ruler.style.left = vertical ? '0' : `${22 + layout.left * zoom}px`;
    ruler.style.top = vertical ? `${22 + (28 + layout.top) * zoom}px` : '0';
    ruler.innerHTML = rulerMarkup(length, zoom, vertical);
  }
}
function updateGuides() {
  const next = normalizeGuides({ rulers: $('showRulers').checked, grid: $('showGrid').checked, snap: $('snapComponents').checked, gridSize: Number($('gridSize').value) });
  finishGesture();
  guides = next;
  updateZoom();
  try { writeStorage(GUIDES_KEY, guides); }
  catch { notify('辅助线设置未保存，浏览器存储不可用或已满', true); }
}
for (const id of ['showRulers', 'showGrid', 'gridSize', 'snapComponents']) $(id).addEventListener('change', updateGuides);
function renderSafeArea() {
  $('safeAreaError').textContent = '';
  const area = project.safeArea;
  const bounds = placementBounds(project);
  $('safeAreaEnabled').checked = area.enabled;
  for (const side of ['top', 'right', 'bottom', 'left']) $(`safe${side[0].toUpperCase()}${side.slice(1)}`).value = area[side];
  $('safeAreaSummary').textContent = area.enabled ? `可放置区域：${bounds.width} × ${bounds.height} px，起点 (${bounds.x}, ${bounds.y})` : '安全区限制已关闭';
  $('canvasSafeArea').hidden = !area.enabled;
  Object.assign($('canvasSafeArea').style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
}
function applySafeArea(event) {
  event.preventDefault();
  if (event.type === 'change' && !$('safeAreaEnabled').checked) {
    finishGesture(); project.safeArea = { ...project.safeArea, enabled: false };
    commit(); notify('安全区限制已关闭'); return;
  }
  if (!$('safeAreaForm').reportValidity()) { $('safeAreaEnabled').checked = project.safeArea.enabled; return; }
  const raw = { enabled: $('safeAreaEnabled').checked };
  for (const side of ['top', 'right', 'bottom', 'left']) raw[side] = Number($(`safe${side[0].toUpperCase()}${side.slice(1)}`).value);
  const bars = systemBarInsets(project.frame, project.canvas);
  if (raw.left + raw.right >= project.canvas.width || raw.top + raw.bottom >= project.canvas.height - bars.top - bars.bottom) {
    $('safeAreaError').textContent = '左右或上下留白总和过大，请至少保留 1 px 的可放置区域';
    $('safeAreaEnabled').checked = project.safeArea.enabled;
    return;
  }
  finishGesture();
  project.safeArea = normalizeSafeArea(raw, project.canvas, project.frame);
  $('safeAreaError').textContent = '';
  commit(); notify(raw.enabled ? '安全区已应用，组件已约束在可放置区域内' : '安全区限制已关闭');
}
$('safeAreaForm').addEventListener('submit', applySafeArea);
$('safeAreaEnabled').addEventListener('change', applySafeArea);
function renderSnapGuides(lines = []) {
  $('canvasSnapGuides').replaceChildren(...lines.map(line => {
    const element = document.createElement('span');
    element.className = `snap-guide ${line.axis === 'x' ? 'vertical' : 'horizontal'}`;
    element.style[line.axis === 'x' ? 'left' : 'top'] = `${line.position}px`;
    return element;
  }));
}
let lastDeviceMarkup = '';
function renderDevice() {
  const device = deviceMarkup(project.canvas, project.frame);
  const signature = device.className + device.style + device.inner;
  if (signature !== lastDeviceMarkup) {
    const canvas = $('canvas');
    const shell = $('deviceShell');
    canvas.remove(); shell.className = device.className; shell.style.cssText = device.style;
    shell.innerHTML = device.inner; shell.querySelector('.device-screen').prepend(canvas);
    shell.querySelector('.device-decoration').inert = true;
    lastDeviceMarkup = signature;
  }
  $('canvasScaler').style.width = `${device.layout.width}px`;
  const frame = project.frame;
  $('frameDevice').value = frame.device;
  $('frameStyle').replaceChildren(...Object.entries({ none: '无外框', ...FRAME_STYLES[frame.device], custom: '自定义 HTML' }).map(([value, label]) => new Option(label, value)));
  $('frameStyle').value = frame.style;
  $('cameraSettings').hidden = frame.device !== 'phone' || frame.style === 'classic';
  $('cameraStyle').replaceChildren(...Object.entries(CAMERA_STYLES).map(([value, label]) => new Option(label, value)));
  $('cameraStyle').value = frame.camera;
  $('systemBarSettings').hidden = frame.device === 'pc';
  $('showStatusBar').checked = frame.statusBar;
  $('statusBarFields').hidden = !frame.statusBar;
  $('statusTime').value = frame.time; $('statusBattery').value = frame.battery;
  $('navigationStyle').value = frame.navigation;
}
function renderCanvas() {
  selectedIds = new Set([...selectedIds].filter(id => project.items.some(item => item.id === id)));
  if (!selectedIds.has(selectedId)) selectedId = [...selectedIds].at(-1) || null;
  const canvas = project.canvas;
  $('canvas').style.width = `${canvas.width}px`;
  $('canvas').style.height = `${canvas.height}px`;
  $('canvas').style.backgroundColor = canvas.background || '#fff';
  renderDevice();
  $('canvasWidthInput').value = canvas.width; $('canvasHeightInput').value = canvas.height;
  $('canvasSizeLabel').textContent = $('artboardSize').textContent = `${canvas.width} × ${canvas.height}`;
  $('presetLabel').textContent = `${PRESETS[canvas.preset]?.label || '自定义'} · ${canvas.width > canvas.height ? '横屏' : '竖屏'}`;
  document.querySelectorAll('[data-preset]').forEach(button => { const active = button.dataset.preset === canvas.preset; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  const ids = new Set(project.items.map(item => item.id));
  for (const [id, node] of itemNodes) if (!ids.has(id)) { node.remove(); itemNodes.delete(id); }
  for (const item of project.items) {
    let node = itemNodes.get(item.id);
    if (!node) { node = document.createElement('div'); node.dataset.itemId = item.id; itemNodes.set(item.id, node); }
    node.className = `editor-item${selectedIds.has(item.id) ? ' selected' : ''}`;
    Object.assign(node.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, borderRadius: `${item.radius}px` });
    const html = itemHTML(item);
    if (node.contentHTML !== html) {
      node.innerHTML = `${html}<span class="item-label">${escapeHTML(item.name)}</span>${['a','b','c','d'].map(corner => `<span class="selection-dot ${corner}"></span>`).join('')}`;
      node.querySelector('.prototype-item').inert = true;
      node.contentHTML = html;
    }
    $('canvas').append(node);
  }
  $('emptyHint').hidden = project.items.length > 0;
  $('componentCount').textContent = `${project.items.length} 个组件`;
  $('undoBtn').disabled = !history.canUndo; $('redoBtn').disabled = !history.canRedo;
  updateZoom(); renderProperties(); renderLayers(); renderSafeArea();
}
function select(id, toggle = false) {
  if (!project.items.some(item => item.id === id)) id = null;
  if (!toggle || !id) selectedIds.clear();
  if (id) {
    if (toggle && selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
  }
  selectedId = selectedIds.has(id) ? id : [...selectedIds].at(-1) || null;
  for (const [key, node] of itemNodes) node.classList.toggle('selected', selectedIds.has(key));
  renderProperties(); renderLayers();
}
function commit(label) { project = constrainProject(project); history.push(project); assistant.record(project, label); renderCanvas(); scheduleSave(); }
function add(component, x = 40, y = 40, snap = false) {
  if (project.items.length >= MAX_ITEMS) throw new Error('单个画布最多 200 个组件');
  const item = createItem(component, project.canvas, x, y, placementBounds(project));
  project.items.push(item); selectedId = item.id; selectedIds = new Set([item.id]);
  if (snap) project = snapItems(project, new Map([[item.id, { x: item.x, y: item.y }]]), 0, 0, zoom).project;
  commit(); notify(`已添加「${item.name}」`);
}
function removeSelected() {
  if (!selectedItem()) return;
  project.items = project.items.filter(item => !selectedIds.has(item.id));
  selectedId = null; selectedIds.clear(); commit(); notify('已删除所选组件，可撤销恢复');
}
function duplicateSelected() {
  const item = selectedItem();
  if (!item) return;
  if (project.items.length + selectedIds.size > MAX_ITEMS) throw new Error('单个画布最多 200 个组件');
  const moved = moveItems(project, selectionStarts(), 16, 16);
  const copies = moved.items.filter(value => selectedIds.has(value.id)).map(value => normalizeItem({ ...clone(value), id: uid(), name: `${value.name} 副本` }, project.canvas));
  project.items.push(...copies); selectedIds = new Set(copies.map(value => value.id)); selectedId = copies.at(-1).id; commit(); notify('已复制所选组件');
}
function restore(direction) {
  finishGesture();
  project = direction === 'undo' ? history.undo() : history.redo();
  assistant.record(project, direction === 'undo' ? '撤销修改' : '重做修改');
  if (!selectedItem()) selectedId = null;
  renderCanvas(); scheduleSave();
}
function finishGesture(cancel = false) {
  renderSnapGuides();
  if (!gesture) return;
  const old = gesture; gesture = null;
  const changed = project.items.some(item => old.starts.has(item.id) && (item.x !== old.starts.get(item.id).x || item.y !== old.starts.get(item.id).y));
  if (cancel) { project = moveItems(project, old.starts, 0, 0); renderCanvas(); }
  else if (changed) commit();
  if (old.node.hasPointerCapture(old.pointerId)) old.node.releasePointerCapture(old.pointerId);
}
// 使用事件委托及指针捕获；选中时保留节点，避免原稿中拖拽引用失效。
$('canvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture) return;
  const node = event.target.closest('.editor-item');
  if (!node) { select(null); return; }
  event.preventDefault();
  if (event.shiftKey || !selectedIds.has(node.dataset.itemId)) select(node.dataset.itemId, event.shiftKey);
  if (!selectedIds.has(node.dataset.itemId)) return;
  selectedId = node.dataset.itemId; renderProperties();
  gesture = { starts: selectionStarts(), pointerId: event.pointerId, node, clientX: event.clientX, clientY: event.clientY };
  node.setPointerCapture(event.pointerId);
  $('canvas').focus({ preventScroll: true });
});
$('canvas').addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const snapped = snapItems(project, gesture.starts, (event.clientX - gesture.clientX) / zoom, (event.clientY - gesture.clientY) / zoom, zoom, guides.snap && !event.altKey);
  project = snapped.project; renderSnapGuides(snapped.guides);
  for (const item of project.items) if (gesture.starts.has(item.id)) {
    const node = itemNodes.get(item.id); node.style.left = `${item.x}px`; node.style.top = `${item.y}px`;
  }
  const item = selectedItem();
  $('propX').value = item.x; $('propY').value = item.y;
});
$('canvas').addEventListener('pointerup', event => { if (event.pointerId === gesture?.pointerId) finishGesture(); });
$('canvas').addEventListener('pointercancel', () => finishGesture(true));
$('canvas').addEventListener('lostpointercapture', () => finishGesture());
window.addEventListener('blur', () => finishGesture());
$('libraryPanel').addEventListener('dragstart', event => {
  const button = event.target.closest('[data-comp-id]');
  if (!button) return;
  event.dataTransfer.setData('text/plain', button.dataset.compId); event.dataTransfer.effectAllowed = 'copy';
});
$('libraryPanel').addEventListener('dragend', () => $('canvas').classList.remove('drag-over'));
$('libraryPanel').addEventListener('click', safeAction(event => {
  const button = event.target.closest('[data-comp-id]');
  const component = button && library.find(value => value.id === button.dataset.compId);
  if (component) add(component, 32 + project.items.length % 8 * 12, 32 + project.items.length % 8 * 12);
}));
$('canvas').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('canvas').classList.add('drag-over'); });
$('canvas').addEventListener('dragleave', event => { if (!$('canvas').contains(event.relatedTarget)) $('canvas').classList.remove('drag-over'); });
$('canvas').addEventListener('drop', safeAction(event => {
  event.preventDefault(); $('canvas').classList.remove('drag-over');
  const component = library.find(value => value.id === event.dataTransfer.getData('text/plain'));
  if (!component) return;
  const point = clientToCanvas(event.clientX, event.clientY, $('canvas').getBoundingClientRect(), zoom);
  add(component, point.x, point.y, guides.snap && !event.altKey);
}));
$('componentSearch').addEventListener('input', renderLibrary);
$('layerList').addEventListener('click', event => { const button = event.target.closest('[data-item-id]'); if (button) select(button.dataset.itemId, event.shiftKey); });
$('alignReference').addEventListener('change', renderProperties);
$('alignmentActions').addEventListener('click', event => {
  const button = event.target.closest('[data-align]');
  if (!button || button.disabled) return;
  finishGesture(); project = alignItems(project, selectedIds, button.dataset.align, $('alignReference').value);
  commit(); notify(`已${button.textContent}（参照${$('alignReference').value === 'canvas' ? '画布' : '所选组件'}）`);
});
function changeLayer(delta) {
  const index = project.items.findIndex(item => item.id === selectedId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= project.items.length) return;
  [project.items[index], project.items[target]] = [project.items[target], project.items[index]];
  commit();
}
$('layerUpBtn').addEventListener('click', () => changeLayer(1)); $('layerDownBtn').addEventListener('click', () => changeLayer(-1));
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  finishGesture();
  const key = button.dataset.preset;
  project = resizeProject(project, PRESETS[key].width, PRESETS[key].height, key); commit();
}));
$('rotateBtn').addEventListener('click', () => { finishGesture(); project = resizeProject(project, project.canvas.height, project.canvas.width, project.canvas.preset); commit(); });
$('canvasSizeForm').addEventListener('submit', event => { event.preventDefault(); finishGesture(); project = resizeProject(project, $('canvasWidthInput').value, $('canvasHeightInput').value); commit(); notify('画布尺寸已更新'); });
function updateFrame(changes) {
  finishGesture();
  project.frame = normalizeFrame({ ...project.frame, ...changes }, 'custom', sanitizeContent);
  commit();
}
function openFrameDialog() {
  $('frameError').textContent = '';
  $('frameCode').value = project.frame.html || CUSTOM_FRAME_HTML;
  for (const side of ['top', 'right', 'bottom', 'left']) $(`frame${side[0].toUpperCase()}${side.slice(1)}`).value = project.frame.insets[side];
  $('frameDialog').showModal();
}
$('frameDevice').addEventListener('change', () => {
  project.canvas.preset = 'custom';
  updateFrame({ device: $('frameDevice').value });
});
$('frameStyle').addEventListener('change', () => {
  if ($('frameStyle').value === 'custom') openFrameDialog();
  else updateFrame({ style: $('frameStyle').value });
});
$('editFrameBtn').addEventListener('click', openFrameDialog);
$('cameraStyle').addEventListener('change', () => updateFrame({ camera: $('cameraStyle').value }));
$('frameDialog').addEventListener('close', renderDevice);
$('frameForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const html = sanitizeContent($('frameCode').value);
    if (!html.trim()) throw new Error('请输入可用的外框 HTML');
    const insets = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, $(`frame${side[0].toUpperCase()}${side.slice(1)}`).value]));
    updateFrame({ style: 'custom', html, insets });
    $('frameDialog').close(); notify('自定义外框已应用');
  } catch (error) { $('frameError').textContent = error.message; }
});
$('showStatusBar').addEventListener('change', () => updateFrame({ statusBar: $('showStatusBar').checked }));
$('navigationStyle').addEventListener('change', () => updateFrame({ navigation: $('navigationStyle').value }));
$('statusTime').addEventListener('change', safeAction(() => {
  const time = $('statusTime').value;
  if (!/^\d{1,2}:\d{2}$/.test(time) || Number(time.split(':')[0]) > 23 || Number(time.split(':')[1]) > 59) { renderDevice(); throw new Error('时间请输入 0:00～23:59'); }
  updateFrame({ time });
}));
$('statusBattery').addEventListener('change', () => updateFrame({ battery: $('statusBattery').value }));
$('selectionProps').addEventListener('submit', safeAction(event => {
  event.preventDefault(); const item = selectedItem(); if (!item) return;
  const next = normalizeItem({ ...item, name: $('propName').value.trim(), x: $('propX').value, y: $('propY').value, width: $('propW').value, height: $('propH').value, radius: $('propRadius').value, padding: $('propPadding').value, margin: $('propMargin').value }, project.canvas, placementBounds(project));
  project.items[project.items.indexOf(item)] = next;
  commit(); notify('组件属性已更新');
}));
$('deleteItemBtn').addEventListener('click', removeSelected);
$('duplicateItemBtn').addEventListener('click', safeAction(duplicateSelected));
$('undoBtn').addEventListener('click', () => restore('undo')); $('redoBtn').addEventListener('click', () => restore('redo'));
$('zoomSelect').addEventListener('change', () => { finishGesture(); zoom = Number($('zoomSelect').value); updateZoom(); });
function fitCanvas() {
  const layout = frameLayout(project.canvas, project.frame);
  const viewport = $('canvasViewport');
  const computed = getComputedStyle(viewport);
  const availableWidth = viewport.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight) - (guides.rulers ? 22 : 0);
  const availableHeight = viewport.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom) - (guides.rulers ? 22 : 0);
  zoom = Math.max(.1, Math.min(1, Math.floor(Math.min(availableWidth / layout.width, availableHeight / (layout.height + 28)) * 100) / 100));
  updateZoom();
}
$('fitBtn').addEventListener('click', fitCanvas);
$('saveLibBtn').addEventListener('click', () => { if (persistLibrary()) notify('组件库已保存到当前浏览器'); });
$('exportLibBtn').addEventListener('click', () => { download(JSON.stringify({ version: 1, components: library }, null, 2), 'protolab-library.json', 'application/json'); notify('组件库 JSON 已导出'); });
$('exportProjectBtn').addEventListener('click', safeAction(() => {
  finishGesture(); download(projectFile(project, library), 'protolab-project.json', 'application/json'); notify('工程已导出，包含画布、设备设置和自定义组件');
}));
$('importProjectBtn').addEventListener('click', () => {
  $('projectForm').reset(); $('projectError').textContent = ''; $('projectDialog').showModal();
});
$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('projectFileInput').files[0]; if (!file || $('applyProjectImportBtn').disabled) return;
  const button = $('applyProjectImportBtn'); button.disabled = true; button.textContent = '正在识别组件…'; $('projectError').textContent = '';
  try {
    const imported = await importProjectFile(file, { width: Number($('importWidth').value), height: Number($('importHeight').value) }, readFile);
    const nextLibrary = imported.components ? completeLibrary(imported.components) : library;
    finishGesture(); project = imported.project; library = nextLibrary;
    selectedId = null; selectedIds.clear(); commit(); renderLibrary();
    if (imported.components) persistLibrary();
    persistProject(); fitCanvas(); $('projectDialog').close();
    notify(`工程已导入，识别 ${project.items.length} 个组件${imported.warnings.length ? `；${imported.warnings.join('；')}` : ''}`);
  } catch (error) { $('projectError').textContent = error.message || '工程导入失败'; }
  finally { button.disabled = false; button.textContent = '导入并替换画布'; }
});
$('importLibBtn').addEventListener('click', () => $('libFileInput').click());
$('libFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > MAX_LIBRARY_BYTES) throw new Error('组件库文件不能超过 12 MB');
  const imported = completeLibrary(validateLibrary(JSON.parse(await readFile(file)), sanitizeContent));
  if (!confirm(`导入后组件库共 ${imported.length} 个组件，替换当前自定义组件，保留内置组件。画布中的组件会保留。建议先导出当前库。`)) return;
  library = imported; renderLibrary(); if (persistLibrary()) notify(`已导入 ${library.length} 个组件`);
}));
function openComponentDialog(type, data = null, name = '') {
  customType = type; imageData = data;
  $('componentForm').reset(); $('componentError').textContent = '';
  $('componentPreviewSection').hidden = true;
  clearComponentPreview($('componentPreview'));
  $('previewComponentBtn').hidden = type === 'image';
  $('customName').value = name;
  $('dialogTitle').textContent = type === 'image' ? '导入图片组件' : `新建 ${type.toUpperCase()} 组件`;
  $('customWidth').value = type === 'svg' ? 60 : 200;
  $('customHeight').value = type === 'svg' ? 60 : 100;
  $('codeField').hidden = type === 'image'; $('customCode').required = type !== 'image';
  $('customCode').value = type === 'svg' ? '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#2563eb"><circle cx="12" cy="12" r="10"/></svg>' : '<div style="width:100%;height:100%;padding:16px;background:#eff6ff;border-radius:8px">我的组件</div>';
  $('componentDialog').showModal(); $('customName').focus();
}
$('addHtmlCompBtn').addEventListener('click', () => openComponentDialog('html'));
$('addSvgCompBtn').addEventListener('click', () => openComponentDialog('svg'));
function readCustomComponent(preview = false) {
  for (const id of ['customWidth', 'customHeight']) {
    if (!$(id).checkValidity()) throw new Error('默认宽度和高度请输入 1～2000 的整数');
  }
  const raw = customType === 'image' ? imageData : $('customCode').value;
  if (customType !== 'image' && raw.length > MAX_CODE) throw new Error('组件代码不能超过 100000 字符');
  return validateLibrary([{ id: uid(), name: preview ? $('customName').value.trim() || '未命名组件' : $('customName').value, type: customType, content: raw, defaultWidth: $('customWidth').value, defaultHeight: $('customHeight').value }], sanitizeContent)[0];
}
function previewCustomComponent() {
  try {
    const component = readCustomComponent(true);
    $('componentError').textContent = '';
    $('componentPreviewSection').hidden = false;
    $('componentPreviewSize').textContent = `${component.defaultWidth} × ${component.defaultHeight} px`;
    renderComponentPreview($('componentPreview'), component);
  } catch (error) {
    clearComponentPreview($('componentPreview'));
    $('componentError').textContent = error.message;
  }
}
$('previewComponentBtn').addEventListener('click', previewCustomComponent);
for (const id of ['customCode', 'customWidth', 'customHeight']) $(id).addEventListener('input', () => {
  if (!$('componentPreviewSection').hidden) previewCustomComponent();
});
$('componentDialog').addEventListener('close', () => {
  clearComponentPreview($('componentPreview'));
  $('componentPreviewSection').hidden = true;
});
$('importImgCompBtn').addEventListener('click', () => $('imgFileInput').click());
$('imgFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片');
  if (file.size > MAX_IMAGE) throw new Error('图片不能超过 3 MB');
  const data = await readFile(file, 'dataURL');
  const image = new Image(); image.src = data;
  try { await image.decode(); } catch { throw new Error('图片内容无效，无法读取'); }
  openComponentDialog('image', data, file.name.replace(/\.[^.]+$/, ''));
  $('customWidth').value = Math.min(image.naturalWidth, 320); $('customHeight').value = Math.max(1, Math.round(Math.min(image.naturalWidth, 320) * image.naturalHeight / image.naturalWidth));
}));
$('componentForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (library.length >= MAX_LIBRARY) throw new Error('组件库最多支持 200 个组件');
    const component = readCustomComponent();
    library = validateLibrary([...library, component], sanitizeContent); renderLibrary(); $('componentDialog').close();
    if (persistLibrary()) notify(`「${component.name}」已添加并保存到组件库`);
  } catch (error) { $('componentError').textContent = error.message; }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('previewBtn').addEventListener('click', () => { finishGesture(); $('previewFrame').srcdoc = exportHTML(project); $('previewDialog').showModal(); });
$('previewDialog').addEventListener('close', () => { $('previewFrame').removeAttribute('srcdoc'); });
$('exportHtmlBtn').addEventListener('click', () => { finishGesture(); download(exportHTML(project), 'prototype.html', 'text/html;charset=utf-8'); notify('原型已导出为 prototype.html'); });
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  const panel = $(button.dataset.panel === 'library' ? 'libraryPanel' : 'propertiesPanel');
  const shouldOpen = !panel.classList.contains('open');
  document.querySelectorAll('.sidebar,.properties').forEach(value => value.classList.remove('open'));
  document.querySelectorAll('[data-panel]').forEach(value => value.setAttribute('aria-expanded', 'false'));
  if (shouldOpen) { panel.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
}));
document.addEventListener('keydown', safeAction(event => {
  if (document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); return; }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); restore('redo'); return; }
  if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (event.key === 'Escape') { finishGesture(true); select(null); return; }
  if (['Delete', 'Backspace'].includes(event.key) && selectedItem()) { event.preventDefault(); removeSelected(); return; }
  const item = selectedItem();
  if (item && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); const distance = event.shiftKey ? 10 : 1;
    project = moveItems(project, selectionStarts(), event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0, event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0); commit();
  }
}));
window.addEventListener('pagehide', () => { finishGesture(); if (saveTimer) persistProject(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) persistProject(); });
renderLibrary(); renderCanvas();
if (window.innerWidth < 900) requestAnimationFrame(fitCanvas);
if (startupWarnings.length) notify(startupWarnings.join('；'), true);
else if (project.items.length) { $('saveState').textContent = '已恢复本地草稿'; $('statusMessage').textContent = '已恢复上次设计 · 所有修改将自动保存'; }
