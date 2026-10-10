import { PRESETS, MAX_ITEMS, MAX_LIBRARY, MAX_LIBRARY_BYTES, MAX_IMAGE, contentSizeValid, uid, clone, normalizeItem, constrainProject, resizeProject, rotateProject, itemBounds, createItem, validateLibrary, validateProject, createHistory, clientToCanvas } from './model.js';
import { ORIENTATION_ACTIONS, normalizeOrientationResponse, orientationPresentation } from './orientation.js';
import { COMPONENTS } from './presets.js';
import { IMAGE_FITS, BLEND_MODES, normalizeAppearance, spacingSides } from './appearance.js';
import { editableContent, updateTextContent, updateImageContent } from './content-editor.js';
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
import { INTERACTIONS, activePage, withPages, switchPage, addPage, deletePage, normalizeInteraction, pageBoard } from './pages.js';
import { PROJECTS_KEY, emptyProject, projectRecord, projectDetails, validateProjects, saveActiveProject, activateProject, appendProject } from './projects.js';

const $ = id => document.getElementById(id);
for (const prefix of ['prop', 'custom']) {
  for (const direction of ['Portrait', 'Landscape']) $(`${prefix}${direction}Action`).replaceChildren(...Object.entries(ORIENTATION_ACTIONS).map(([value, label]) => new Option(label, value)));
  $(`${prefix}OrientationEnabled`).addEventListener('change', () => updateOrientationFields(prefix));
}
function updateOrientationFields(prefix) {
  const enabled = $(`${prefix}OrientationEnabled`).checked;
  $(`${prefix}OrientationFields`).hidden = !enabled;
  for (const direction of ['Portrait', 'Landscape']) $(`${prefix}${direction}Action`).disabled = !enabled;
}
function readOrientationFields(prefix) {
  return normalizeOrientationResponse({ enabled: $(`${prefix}OrientationEnabled`).checked,
    portrait: $(`${prefix}PortraitAction`).value, landscape: $(`${prefix}LandscapeAction`).value });
}
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
const sharedStyles = document.createElement('style');
sharedStyles.textContent = PROTOTYPE_CSS;
document.head.append(sharedStyles);
let library = clone(COMPONENTS);
let project = withPages(validateProject({ version: 1, canvas: { ...PRESETS.phone, preset: 'phone' }, frame: normalizeFrame({ camera: 'island' }), items: [] }, sanitizeContent));
let selectedId = null;
let selectedIds = new Set();
let guides = normalizeGuides();
let zoom = 1;
let gesture = null;
let saveTimer;
let toastTimer;
let customType = 'html';
let imageData = null;
let libraryTab = 'basic';
let propertyContent = { texts: [], images: [] };
let pendingImages = new Map();
const appearanceFields = { propBackground: 'background', propColor: 'color', propTextColor: 'textColor', propFontFamily: 'fontFamily', propFontSize: 'fontSize', propFontWeight: 'fontWeight', propOpacity: 'opacity', propBlendMode: 'blendMode', propImageFit: 'imageFit' };
let startupWarnings = [];
let initialSavedAt = null;
let catalog = null;
let catalogReadable = true;
let projectSession = 0;
const currentRecord = () => catalog?.entries.find(entry => entry.id === catalog.activeId);
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
  try {
    if (!catalogReadable) throw new Error('工程列表读取失败');
    const next = saveActiveProject(catalog, { project, library, workspace: { ...assistant.snapshot(), savedAt } });
    writeStorage(PROJECTS_KEY, next); catalog = next;
  } catch { saved = false; }
  if (saved) {
    try { assistant.persist(savedAt); } catch { saved = false; }
    try { writeStorage(PROJECT_KEY, { ...project, savedAt }); } catch { saved = false; }
  }
  $('saveState').textContent = saved ? '已自动保存' : '草稿未保存';
  if (!saved) notify('草稿或版本未保存成功，浏览器存储不可用或已满，请导出版本备份保留设计与历史。', true);
  return saved;
}
function scheduleSave() {
  $('saveState').textContent = '正在保存…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistProject, 300);
}
function persistLibrary() {
  try { if (!persistProject()) return false; writeStorage(LIBRARY_KEY, { version: 1, components: library }); return true; }
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
  if (saved) project = withPages(saved);
} catch { startupWarnings.push('草稿读取失败，已打开空画布'); }
library = completeLibrary(library);
try {
  catalog = readStorage(PROJECTS_KEY, value => validateProjects(value, sanitizeContent));
  if (catalog) { project = currentRecord().project; library = completeLibrary(currentRecord().library); initialSavedAt = null; }
} catch { catalogReadable = false; startupWarnings.push('工程列表读取失败，原始数据已保留；请备份本地数据后恢复，暂不允许新建或切换工程'); }
const assistant = createAssistant({
  initial: project, initialSavedAt, initialWorkspace: currentRecord()?.workspace, getProject: () => project, getRules: () => currentRecord()?.rules || '', finishGesture, notify, scheduleSave,
  restoreInitial(value) { project = withPages(value); },
  applyProject(value, label) { finishGesture(); project = withPages(value); selectedId = null; selectedIds.clear(); commit(label); },
  applyGeneration(result) {
    finishGesture();
    if (result.mode === 'component') {
      const nextLibrary = validateLibrary([...library, { ...result.component, id: uid(), name: result.name }], sanitizeContent);
      library = nextLibrary; setLibraryTab('custom'); persistLibrary();
    } else {
      let next = addPage(project);
      const pageId = next.activePageId;
      const board = pageBoard(result.project);
      board.items = board.items.map(item => ({ ...item, id: uid() }));
      next = { ...next, ...board, pages: next.pages.map(page => page.id === pageId ? { ...page, name: result.name, ...board } : page) };
      project = validateProject(next, sanitizeContent); selectedId = null; selectedIds.clear(); commit(`AI 生成页面：${result.name}`); fitCanvas();
    }
  },
  startupWarning(message) { startupWarnings.push(message); },
});
if (!catalog) {
  const entry = projectRecord({ name: '未命名工程' }, project, library, assistant.snapshot());
  catalog = { version: 1, activeId: entry.id, entries: [entry] };
}
let history = createHistory(project);
function renderProjects() {
  $('projectSelect').replaceChildren(...catalog.entries.map(entry => new Option(entry.name, entry.id)));
  $('projectSelect').value = catalog.activeId;
  assistant.refreshRules();
}
function openProjectDetails(create) {
  $('engineeringForm').reset(); $('engineeringError').textContent = '';
  $('engineeringTitle').textContent = create ? '新建工程' : '工程设置';
  $('engineeringForm').dataset.create = String(create);
  $('engineeringName').value = create ? '' : currentRecord().name;
  $('engineeringRules').value = create ? '' : currentRecord().rules;
  $('engineeringPresetField').hidden = !create;
  $('engineeringSubmitBtn').textContent = create ? '创建并切换' : '保存设置';
  $('engineeringDialog').showModal(); $('engineeringName').focus();
}
function installProject(next) {
  // 先原子写入完整工程集合，再切换内存；写入失败保留当前工程。
  writeStorage(PROJECTS_KEY, next);
  catalog = next;
  projectSession++;
  const entry = currentRecord();
  project = withPages(entry.project); library = completeLibrary(entry.library);
  assistant.activate(project, entry.workspace);
  selectedId = null; selectedIds.clear(); history = createHistory(project);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('componentSearch').value = ''; renderProjects(); setLibraryTab('basic'); renderCanvas(); fitCanvas(); persistProject();
  notify(`已切换到「${entry.name}」${entry.workspace.pending ? '，有 AI 版本等待合并' : ''}`);
}
$('newProjectBtn').addEventListener('click', () => openProjectDetails(true));
$('engineeringSettingsBtn').addEventListener('click', () => openProjectDetails(false));
$('projectSelect').addEventListener('change', safeAction(() => {
  const id = $('projectSelect').value;
  if (id === catalog.activeId) return;
  try {
    finishGesture();
    if (!persistProject()) throw new Error('当前工程保存失败，已保留当前工程，请先导出备份');
    installProject(activateProject(catalog, id));
  } finally { $('projectSelect').value = catalog.activeId; }
}));
$('engineeringForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const details = projectDetails({ name: $('engineeringName').value, rules: $('engineeringRules').value });
    finishGesture();
    if (!persistProject()) throw new Error('当前工程保存失败，请先导出备份，再新建或更改工程设置');
    if ($('engineeringForm').dataset.create === 'true') {
      const entry = projectRecord(details, emptyProject($('engineeringPreset').value), clone(COMPONENTS));
      installProject(appendProject(catalog, entry));
    } else {
      const next = saveActiveProject(catalog, details);
      writeStorage(PROJECTS_KEY, next); catalog = next; renderProjects(); $('engineeringDialog').close(); notify('工程名称和 AI 设计规范已保存');
    }
  } catch (error) { $('engineeringError').textContent = error.message; }
});
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
  $('customCount').textContent = query ? visible.filter(component => !component.builtin).length : customCount;
  $('basicCount').textContent = visible.filter(component => component.builtin && component.type !== 'svg').length;
  $('vectorCount').textContent = visible.filter(component => component.builtin && component.type === 'svg').length;
  const count = visible.filter(component => libraryCategory(component) === libraryTab).length;
  $('libraryEmpty').hidden = count > 0 || libraryTab === 'custom';
  $('customEmpty').hidden = visible.some(component => !component.builtin);
  $('customEmpty').textContent = query ? '没有找到匹配的自定义组件' : '把常用的设计，变成自己的组件。';
  for (const category of ['basic', 'vector', 'custom']) {
    const tab = $(`${category}Tab`), active = libraryTab === category;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(`${category}Panel`).hidden = !active;
  }
}
function libraryCategory(component) { return !component.builtin ? 'custom' : component.type === 'svg' ? 'vector' : 'basic'; }
function setLibraryTab(category, focus = false) {
  libraryTab = category; renderLibrary();
  if (focus) $(`${category}Tab`).focus();
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
  for (const [field, key] of Object.entries({ propName: 'name', propX: 'x', propY: 'y', propW: 'width', propH: 'height', propRadius: 'radius' })) $(field).value = item[key];
  for (const key of ['padding', 'margin']) for (const [side, value] of Object.entries(spacingSides(item[key]))) $(`prop${key[0].toUpperCase()}${key.slice(1)}${side[0].toUpperCase()}${side.slice(1)}`).value = value;
  const appearance = normalizeAppearance(item.appearance);
  for (const [field, key] of Object.entries(appearanceFields)) $(field).value = appearance[key] ?? (key === 'opacity' ? 100 : key === 'blendMode' ? 'normal' : '');
  for (const field of ['propBackground', 'propColor', 'propTextColor']) syncColorPicker(field);
  propertyContent = editableContent(item); pendingImages = new Map();
  $('textProperties').hidden = !propertyContent.texts.length;
  $('textContentFields').replaceChildren(...propertyContent.texts.map(({ label, value }, index) => {
    const field = document.createElement('label'); field.className = 'field'; field.textContent = label;
    const input = document.createElement('textarea'); input.rows = 2; input.value = value; input.dataset.textIndex = index;
    field.append(input); return field;
  }));
  $('imageProperties').hidden = !propertyContent.images.length;
  $('propImageTarget').replaceChildren(...propertyContent.images.map(({ label }, index) => new Option(label, String(index))));
  $('propImageFile').value = ''; renderPropertyImage();
  const response = normalizeOrientationResponse(item.orientationResponse);
  $('propOrientationEnabled').checked = response.enabled;
  $('propPortraitAction').value = response.portrait; $('propLandscapeAction').value = response.landscape;
  updateOrientationFields('prop');
  $('propClickAction').value = item.interaction?.type || 'none';
  renderInteractionTargets(item.interaction?.targetId);
}
function syncColorPicker(field) {
  const value = $(field).value;
  $(`${field}Picker`).value = /^#[\da-f]{6}$/i.test(value) ? value : /^#[\da-f]{3}$/i.test(value) ? '#' + [...value.slice(1)].map(char => char + char).join('') : '#000000';
}
function renderPropertyImage() {
  const index = Number($('propImageTarget').value);
  const source = pendingImages.get(index) ?? propertyContent.images[index]?.source ?? '';
  $('propImageSource').value = source;
  $('propImagePreview').hidden = !/^data:image\//.test(source);
  if (!$('propImagePreview').hidden) $('propImagePreview').src = source;
  else $('propImagePreview').removeAttribute('src');
}
function readPropertySpacing(key) {
  return ['Top', 'Right', 'Bottom', 'Left'].map(side => `${Number($(`prop${key}${side}`).value)}px`).join(' ');
}
function readPropertyAppearance() {
  const values = Object.fromEntries(Object.entries(appearanceFields).map(([field, key]) => [key, $(field).value]));
  // 隐藏的内容编辑器不增加新的字体或图片样式。
  if ($('textProperties').hidden) for (const key of ['textColor', 'fontFamily', 'fontSize', 'fontWeight']) values[key] = selectedItem().appearance?.[key];
  if ($('imageProperties').hidden) values.imageFit = selectedItem().appearance?.imageFit;
  return normalizeAppearance(values);
}
$('propBlendMode').replaceChildren(...Object.entries(BLEND_MODES).map(([value, label]) => new Option(label, value)));
$('propImageFit').append(...Object.entries(IMAGE_FITS).map(([value, label]) => new Option(label, value)));
for (const field of ['propBackground', 'propColor', 'propTextColor']) {
  $(field).addEventListener('input', () => syncColorPicker(field));
  $(`${field}Picker`).addEventListener('input', event => { $(field).value = event.target.value; });
}
$('propImageTarget').addEventListener('change', renderPropertyImage);
$('propImageSource').addEventListener('input', () => {
  const index = Number($('propImageTarget').value), value = $('propImageSource').value.trim();
  if (value === propertyContent.images[index]?.source || !value) pendingImages.delete(index);
  else pendingImages.set(index, value);
});
$('propImageFile').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const item = selectedItem(), session = projectSession, index = Number($('propImageTarget').value);
  const source = await readImageFile(file);
  if (session !== projectSession || selectedItem() !== item) throw new Error('所选组件已变化，请重新设置图片');
  pendingImages.set(index, source); renderPropertyImage();
  notify('图片已准备好，点击应用属性保存');
}));
function renderInteractionTargets(targetId = $('propClickTarget').value) {
  const type = $('propClickAction').value;
  const needsTarget = ['navigate', 'openPopup'].includes(type);
  $('propClickTargetField').hidden = !needsTarget;
  $('propClickTarget').required = needsTarget;
  $('propClickTarget').disabled = !needsTarget;
  const targets = project.pages.filter(page => page.kind === (type === 'navigate' ? 'page' : 'popup'));
  $('propClickTarget').replaceChildren(new Option('请选择目标', ''), ...targets.map(page => new Option(page.name, page.id)));
  $('propClickTarget').value = targets.some(page => page.id === targetId) ? targetId : '';
  $('interactionHelp').textContent = needsTarget && !targets.length ? '请先新建目标弹窗。' : '在预览和导出的 HTML 中点击组件执行动作。';
}
$('propClickAction').replaceChildren(...Object.entries(INTERACTIONS).map(([value, label]) => new Option(label, value)));
$('propClickAction').addEventListener('change', () => renderInteractionTargets(''));
function renderPages() {
  $('pageList').replaceChildren(...project.pages.map(page => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `page-tab${page.id === project.activePageId ? ' active' : ''}`;
    button.dataset.pageId = page.id; button.setAttribute('aria-pressed', String(page.id === project.activePageId));
    button.textContent = `${page.kind === 'popup' ? '弹窗 · ' : ''}${page.name}${page.id === project.startPageId ? ' · 首页' : ''}`;
    return button;
  }));
  const page = activePage(project);
  $('artboardName').textContent = page.name;
  $('pageSummary').textContent = `${project.pages.filter(page => page.kind === 'page').length} 页面 · ${project.pages.filter(page => page.kind === 'popup').length} 弹窗`;
}
function applyPageChange(next, label) {
  project = next; selectedId = null; selectedIds.clear(); commit(label);
}
$('pageList').addEventListener('click', safeAction(event => {
  const button = event.target.closest('[data-page-id]');
  if (!button || button.dataset.pageId === project.activePageId) return;
  finishGesture(); applyPageChange(switchPage(project, button.dataset.pageId), '切换编辑页面');
}));
for (const [id, kind] of [['addPageBtn', 'page'], ['addPopupBtn', 'popup']]) $(id).addEventListener('click', safeAction(() => {
  finishGesture(); applyPageChange(addPage(project, kind), kind === 'popup' ? '新增弹窗' : '新增页面');
}));
let managedPageId = null;
$('managePageBtn').addEventListener('click', () => {
  finishGesture(); const page = activePage(project); managedPageId = page.id;
  $('pageName').value = page.name; $('pageError').textContent = '';
  $('pageStart').checked = page.id === project.startPageId; $('pageStart').disabled = page.kind === 'popup';
  $('deletePageBtn').disabled = page.kind === 'page' && project.pages.filter(page => page.kind === 'page').length === 1;
  $('pageDialog').showModal();
});
$('pageForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('pageName').value.trim();
  if (!name) { $('pageError').textContent = '请输入页面名称'; return; }
  const page = project.pages.find(page => page.id === managedPageId);
  page.name = name;
  if (page.kind === 'page' && $('pageStart').checked) project.startPageId = page.id;
  commit('更新页面名称与首页'); $('pageDialog').close();
});
$('duplicatePageBtn').addEventListener('click', safeAction(() => {
  applyPageChange(addPage(project, 'page', true), '复制页面或弹窗'); $('pageDialog').close();
}));
$('deletePageBtn').addEventListener('click', safeAction(() => {
  applyPageChange(deletePage(project, managedPageId), '删除页面或弹窗'); $('pageDialog').close();
  notify('已删除，关联跳转已清除，可撤销恢复');
}));
function renderLayers() {
  $('layerList').replaceChildren();
  for (const item of [...project.items].reverse()) {
    const button = document.createElement('button');
    button.className = `layer-item${selectedIds.has(item.id) ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selectedIds.has(item.id)));
    button.dataset.itemId = item.id;
    const hidden = orientationPresentation(item, project.canvas).hidden;
    button.innerHTML = `${icon(item.type === 'image' ? 'image' : item.type === 'svg' ? 'star' : 'layers')}<span>${escapeHTML(item.name)}${hidden ? ' · 当前方向隐藏' : ''}</span>`;
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
  project = constrainProject(project, true);
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
  project = withPages(project);
  renderPages();
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
    const presentation = orientationPresentation(item, canvas);
    node.hidden = presentation.hidden;
    node.style.transform = presentation.angle ? `rotate(${presentation.angle}deg)` : '';
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
function commit(label) { project = constrainProject(withPages(project)); history.push(project); assistant.record(project, label); renderCanvas(); scheduleSave(); }
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
  const copies = moved.items.filter(value => selectedIds.has(value.id)).map(value => normalizeItem({ ...clone(value), id: uid(), name: `${value.name} 副本` }, project.canvas, itemBounds(project)));
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
document.querySelector('.library-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-library-tab]'); if (tab) setLibraryTab(tab.dataset.libraryTab);
});
document.querySelector('.library-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const categories = ['basic', 'vector', 'custom'];
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (categories.indexOf(libraryTab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
  setLibraryTab(categories[index], true);
});
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
$('rotateBtn').addEventListener('click', () => { finishGesture(); project = rotateProject(project); commit(); });
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
$('selectionProps').addEventListener('submit', safeAction(async event => {
  event.preventDefault(); const item = selectedItem(); if (!item) return;
  const session = projectSession, images = [...pendingImages.values()];
  let content = updateTextContent(item, [...$('textContentFields').querySelectorAll('[data-text-index]')].map(input => input.value));
  for (const [index, source] of pendingImages) content = updateImageContent({ ...item, content }, index, source);
  if (!contentSizeValid(content, item.type)) throw new Error('组件内容过大，请使用较小图片或独立图片组件');
  const geometryChanged = Object.entries({ propX: 'x', propY: 'y', propW: 'width', propH: 'height' }).some(([field, key]) => Number($(field).value) !== item[key]);
  const next = normalizeItem({ ...item, content, appearance: readPropertyAppearance(), name: $('propName').value.trim(), x: $('propX').value, y: $('propY').value, width: $('propW').value, height: $('propH').value, radius: $('propRadius').value, padding: readPropertySpacing('Padding'), margin: readPropertySpacing('Margin'), orientationResponse: readOrientationFields('prop'), interaction: normalizeInteraction({ type: $('propClickAction').value, targetId: $('propClickTarget').value }) }, project.canvas, geometryChanged ? placementBounds(project) : itemBounds(project));
  for (const source of images) {
    const image = new Image(); image.src = source;
    try { await image.decode(); } catch { throw new Error('图片内容无效，无法读取'); }
  }
  if (session !== projectSession || selectedItem() !== item) throw new Error('所选组件已变化，请重新应用属性');
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
  finishGesture(); download(projectFile(project, library, projectDetails(currentRecord())), 'protolab-project.json', 'application/json'); notify('工程已导出，包含画布、设备设置、自定义组件及工程规范');
}));
$('importProjectBtn').addEventListener('click', () => {
  $('projectForm').reset(); $('projectError').textContent = ''; $('projectDialog').showModal();
});
$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('projectFileInput').files[0]; if (!file || $('applyProjectImportBtn').disabled) return;
  const button = $('applyProjectImportBtn'); button.disabled = true; button.textContent = '正在识别组件…'; $('projectError').textContent = '';
  const sourceSession = projectSession;
  try {
    const imported = await importProjectFile(file, { width: Number($('importWidth').value), height: Number($('importHeight').value) }, readFile);
    if (sourceSession !== projectSession) throw new Error('工程已切换，请在目标工程重新导入');
    const nextLibrary = imported.components ? completeLibrary(imported.components) : library;
    finishGesture(); project = imported.project; library = nextLibrary;
    selectedId = null; selectedIds.clear(); commit(); renderLibrary();
    if (imported.details) { catalog = saveActiveProject(catalog, imported.details); renderProjects(); }
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
  const sourceSession = projectSession;
  const imported = completeLibrary(validateLibrary(JSON.parse(await readFile(file)), sanitizeContent));
  if (sourceSession !== projectSession) throw new Error('工程已切换，请重新导入组件库');
  if (!confirm(`导入后组件库共 ${imported.length} 个组件，替换当前自定义组件，保留内置组件。画布中的组件会保留。建议先导出当前库。`)) return;
  library = imported; renderLibrary(); if (persistLibrary()) notify(`已导入 ${library.length} 个组件`);
}));
function openComponentDialog(type, data = null, name = '') {
  customType = type; imageData = data;
  $('componentForm').reset(); $('componentError').textContent = '';
  updateOrientationFields('custom');
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
  if (!contentSizeValid(raw, customType)) throw new Error('组件标记不能超过 100000 字符，内嵌图片另计体积');
  return validateLibrary([{ id: uid(), name: preview ? $('customName').value.trim() || '未命名组件' : $('customName').value, type: customType, content: raw, defaultWidth: $('customWidth').value, defaultHeight: $('customHeight').value, orientationResponse: readOrientationFields('custom') }], sanitizeContent)[0];
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
async function readImageFile(file) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片');
  if (file.size > MAX_IMAGE) throw new Error('图片不能超过 3 MB');
  const data = await readFile(file, 'dataURL');
  const image = new Image(); image.src = data;
  try { await image.decode(); } catch { throw new Error('图片内容无效，无法读取'); }
  return data;
}
$('imgFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const sourceSession = projectSession;
  const data = await readImageFile(file);
  const image = new Image(); image.src = data;
  try { await image.decode(); } catch { throw new Error('图片内容无效，无法读取'); }
  if (sourceSession !== projectSession) throw new Error('工程已切换，请重新导入图片');
  openComponentDialog('image', data, file.name.replace(/\.[^.]+$/, ''));
  $('customWidth').value = Math.min(image.naturalWidth, 320); $('customHeight').value = Math.max(1, Math.round(Math.min(image.naturalWidth, 320) * image.naturalHeight / image.naturalWidth));
}));
$('componentForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (library.length >= MAX_LIBRARY) throw new Error('组件库最多支持 200 个组件');
    const component = readCustomComponent();
    library = validateLibrary([...library, component], sanitizeContent); setLibraryTab('custom'); $('componentDialog').close();
    if (persistLibrary()) notify(`「${component.name}」已添加并保存到组件库`);
  } catch (error) { $('componentError').textContent = error.message; }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('previewBtn').addEventListener('click', () => { finishGesture(); $('previewFrame').srcdoc = exportHTML(project, { preview: true }); $('previewDialog').showModal(); });
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
renderProjects(); renderLibrary(); renderCanvas();
if (window.innerWidth < 900) requestAnimationFrame(fitCanvas);
if (startupWarnings.length) notify(startupWarnings.join('；'), true);
else if (project.items.length) { $('saveState').textContent = '已恢复本地草稿'; $('statusMessage').textContent = '已恢复上次设计 · 所有修改将自动保存'; }
