import { t, translate, getLocale, bindStaticTranslations, initializeLanguage } from './i18n.js';
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
import { visibilityLayout, expandedY } from './visibility.js';
import { GUIDES_KEY, normalizeGuides, rulerMarkup } from './guides.js';
import { projectFile, importProjectFile } from './project-import.js';
import { normalizeSafeArea, placementBounds } from './safe-area.js';
import { snapItems } from './snapping.js';
import { createAssistant } from './assistant.js';
import { INTERACTIONS, PAGE_KINDS, activePage, withPages, switchPage, addPage, deletePage, normalizeInteraction, pageBoard, copyItems, cleanVisibilityTargets } from './pages.js';
import { PROJECTS_KEY, emptyProject, projectRecord, projectDetails, validateProjects, saveActiveProject, activateProject, appendProject } from './projects.js';
import { COLOR_ROLES, PALETTES, normalizeDesign, linkedComponents, libraryManifest, designAssets } from './project-design.js';
import { initializeCollapsible } from './collapsible.js';
import { attachViewportZoom } from './viewport-zoom.js';
import { attachViewportPan } from './viewport-pan.js';
import { validateGroups, mergeLibrary } from './library-groups.js';
import { initializeTabs } from './panel-tabs.js';
import { initializeMenus } from './menus.js';
import { createMCPEditor } from './mcp-editor.js';
import { initializeMCPConnection } from './mcp-connection.js';

const $ = id => document.getElementById(id);
const refreshStaticTranslations = bindStaticTranslations(document);
for (const prefix of ['prop', 'custom']) {
  for (const direction of ['Portrait', 'Landscape']) $(`${prefix}${direction}Action`).replaceChildren(...Object.entries(ORIENTATION_ACTIONS).map(([value, label]) => new Option(t(label), value)));
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
initializeCollapsible();
initializeMenus(document.querySelector('.app-menubar'));
initializeMenus($('pageAddMenu'));
const setPropertiesTab = initializeTabs(document.querySelector('[aria-label="属性分类"]'), 'data-properties-tab');
initializeTabs(document.querySelector('[aria-label="设计记录"]'), 'data-activity-tab');
const sharedStyles = document.createElement('style');
sharedStyles.textContent = PROTOTYPE_CSS;
document.head.append(sharedStyles);
let library = clone(COMPONENTS);
let libraryGroups = [];
let groupFilter = 'all';
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
let previewSession = null;
const currentRecord = () => catalog?.entries.find(entry => entry.id === catalog.activeId);
function completeLibrary(values) {
  const ids = new Set(COMPONENTS.map(component => component.id));
  return validateLibrary([...COMPONENTS, ...values.filter(component => !ids.has(component.id))], sanitizeContent);
}

function notify(message, error = false) {
  $('toast').textContent = t(message);
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  $('statusMessage').textContent = t(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6000 : 3500);
}
function safeAction(action) {
  return async (...args) => { try { await action(...args); } catch (error) { notify(error.message || t('操作失败，请重试'), true); } };
}
function persistProject() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const savedAt = new Date().toISOString();
  let saved = true;
  try {
    if (!catalogReadable) throw new Error(t('工程列表读取失败'));
    const next = saveActiveProject(catalog, { project, library, libraryGroups, workspace: { ...assistant.snapshot(), savedAt } });
    writeStorage(PROJECTS_KEY, next); catalog = next;
  } catch { saved = false; }
  if (saved) {
    try { assistant.persist(savedAt); } catch { saved = false; }
    try { writeStorage(PROJECT_KEY, { ...project, savedAt }); } catch { saved = false; }
  }
  $('saveState').textContent = saved ? t('已自动保存') : t('草稿未保存');
  if (!saved) notify(t('草稿或版本未保存成功，浏览器存储不可用或已满，请导出版本备份保留设计与历史。'), true);
  return saved;
}
function scheduleSave() {
  $('saveState').textContent = t('正在保存…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistProject, 300);
}
function persistLibrary() {
  try { if (!persistProject()) return false; writeStorage(LIBRARY_KEY, { version: 1, components: library, groups: libraryGroups }); return true; }
  catch { notify(t('组件库保存在内存中，浏览器存储不可用或已满。请导出 JSON 备份。'), true); return false; }
}
// 恢复失败不覆盖损坏的数据，以便用户仍可手动备份。
try {
  const saved = readStorage(LIBRARY_KEY, value => ({ components: validateLibrary(value, sanitizeContent), groups: validateGroups(value.groups) }));
  if (saved) { library = completeLibrary(saved.components); libraryGroups = saved.groups; }
  else {
    const legacy = readStorage('proto_component_library', value => validateLibrary(value, sanitizeContent));
    if (legacy) library = completeLibrary(legacy);
  }
} catch { startupWarnings.push(t('组件库读取失败，已使用基础组件')); }
try {
  const saved = readStorage(PROJECT_KEY, value => { initialSavedAt = value.savedAt || null; return validateProject(value, sanitizeContent); });
  if (saved) project = withPages(saved);
} catch { startupWarnings.push(t('草稿读取失败，已打开空画布')); }
library = completeLibrary(library);
try {
  catalog = readStorage(PROJECTS_KEY, value => validateProjects(value, sanitizeContent));
  if (catalog) { project = currentRecord().project; library = completeLibrary(currentRecord().library); libraryGroups = currentRecord().libraryGroups; initialSavedAt = null; }
} catch { catalogReadable = false; startupWarnings.push(t('工程列表读取失败，原始数据已保留；请备份本地数据后恢复，暂不允许新建或切换工程')); }
const assistant = createAssistant({
  initial: project, initialSavedAt, initialWorkspace: currentRecord()?.workspace, getProject: () => project, getRules: () => currentRecord()?.rules || '',
  getDesignAssets: () => designAssets(currentRecord()?.design, project, library, libraryGroups), finishGesture, notify, scheduleSave,
  restoreInitial(value) { project = withPages(value); },
  applyProject(value, label) { finishGesture(); project = withPages(value); selectedId = null; selectedIds.clear(); commit(label); },
  applyGeneration(result) {
    finishGesture();
    if (result.mode === 'component') {
      const nextLibrary = validateLibrary([...library, { ...result.component, id: uid(), name: result.name }], sanitizeContent);
      library = nextLibrary; commit(t`AI 生成组件：${result.name}`); setLibraryTab('custom'); persistLibrary();
    } else {
      let next = addPage(project);
      const pageId = next.activePageId;
      const board = pageBoard(result.project);
      board.items = board.items.map(item => ({ ...item, id: uid() }));
      next = { ...next, ...board, pages: next.pages.map(page => page.id === pageId ? { ...page, name: result.name, ...board } : page) };
      project = validateProject(next, sanitizeContent); selectedId = null; selectedIds.clear(); commit(t`AI 生成页面：${result.name}`); fitCanvas();
    }
  },
  startupWarning(message) { startupWarnings.push(message); },
});
if (!catalog) {
  const entry = { ...projectRecord({ name: t('未命名工程') }, project, library, assistant.snapshot()), libraryGroups };
  catalog = { version: 1, activeId: entry.id, entries: [entry] };
}
let history = createHistory({ project, library, libraryGroups });
const projectHistories = new Map([[catalog.activeId, history]]);
function renderProjects() {
  $('projectSelect').replaceChildren(...catalog.entries.map(entry => new Option(entry.name, entry.id)));
  $('projectSelect').value = catalog.activeId;
  assistant.refreshRules();
}
function openProjectDetails(create) {
  $('engineeringForm').reset(); $('engineeringError').textContent = '';
  $('engineeringTitle').textContent = create ? t('新建工程') : t('工程设置');
  $('engineeringForm').dataset.create = String(create);
  $('engineeringName').value = create ? '' : currentRecord().name;
  $('engineeringRules').value = create ? '' : currentRecord().rules;
  fillEngineeringDesign(create ? normalizeDesign() : normalizeDesign(currentRecord().design));
  $('engineeringPresetField').hidden = !create;
  $('engineeringSubmitBtn').textContent = create ? t('创建并切换') : t('保存设置');
  $('engineeringDialog').showModal(); $('engineeringName').focus();
}
function engineeringLibrary() {
  return $('engineeringForm').dataset.create === 'true' ? COMPONENTS : library;
}
function engineeringGroups() {
  return $('engineeringForm').dataset.create === 'true' ? [] : libraryGroups;
}
function readEngineeringDesign() {
  const palette = $('engineeringPalette').value === 'none' ? null : { name: $('engineeringPaletteName').value,
    colors: Object.fromEntries(Object.keys(COLOR_ROLES).map(role => [role, document.getElementById(`engineeringColor-${role}`).value])) };
  return normalizeDesign({ palette, library: { scope: $('engineeringLibraryScope').value,
    groupIds: [...$('engineeringLibraryGroups').querySelectorAll('input:checked')].map(input => input.value) },
    safeArea: { mode: $('engineeringSafeMode').value, ...Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, Number(document.getElementById(`engineeringSafe${edge[0].toUpperCase()}${edge.slice(1)}`).value)])) } });
}
function engineeringManifest() {
  const selection = { library: { scope: $('engineeringLibraryScope').value,
    groupIds: [...$('engineeringLibraryGroups').querySelectorAll('input:checked')].map(input => input.value) } };
  return libraryManifest(linkedComponents(selection, engineeringLibrary(), engineeringGroups()), engineeringGroups());
}
function renderEngineeringLinks() {
  const paletteEnabled = $('engineeringPalette').value !== 'none';
  $('engineeringPaletteFields').hidden = !paletteEnabled;
  $('engineeringPaletteName').required = paletteEnabled;
  const customSafe = $('engineeringSafeMode').value === 'custom';
  $('engineeringSafeFields').hidden = !customSafe;
  for (const input of $('engineeringSafeFields').querySelectorAll('input')) { input.disabled = !customSafe; input.required = customSafe; }
  $('engineeringLibraryGroups').hidden = $('engineeringLibraryScope').value !== 'groups';
  const manifest = engineeringManifest();
  $('engineeringManifestSummary').textContent = t`轻量组件清单 · ${manifest.components.length} 个组件`;
  $('engineeringManifest').textContent = JSON.stringify(manifest, null, 2);
}
function fillEngineeringColors(palette) {
  $('engineeringPaletteName').value = palette.name;
  $('engineeringColors').replaceChildren(...Object.entries(COLOR_ROLES).map(([role, name]) => {
    const label = document.createElement('label'); label.className = 'field'; label.textContent = t(name);
    const input = document.createElement('input'); input.type = 'color'; input.id = `engineeringColor-${role}`; input.value = palette.colors[role]; label.append(input); return label;
  }));
}
function fillEngineeringDesign(design) {
  $('engineeringPalette').value = design.palette ? 'custom' : 'none';
  fillEngineeringColors(design.palette || PALETTES.blue);
  $('engineeringLibraryScope').value = design.library.scope;
  $('engineeringLibraryGroups').replaceChildren(...engineeringGroups().map(group => {
    const label = document.createElement('label'); label.className = 'checkbox-field'; label.dataset.i18nIgnore = '';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = group.id; input.checked = design.library.groupIds.includes(group.id);
    label.append(input, document.createTextNode(group.name)); return label;
  }));
  if (!engineeringGroups().length) $('engineeringLibraryGroups').textContent = t('当前工程暂无分组，请先在组件库中新建分组。');
  $('engineeringSafeMode').value = design.safeArea.mode;
  for (const edge of ['top', 'right', 'bottom', 'left']) document.getElementById(`engineeringSafe${edge[0].toUpperCase()}${edge.slice(1)}`).value = design.safeArea[edge] || 0;
  renderEngineeringLinks();
}
$('engineeringPalette').addEventListener('change', () => {
  if (PALETTES[$('engineeringPalette').value]) fillEngineeringColors(PALETTES[$('engineeringPalette').value]);
  renderEngineeringLinks();
});
$('engineeringColors').addEventListener('input', () => { $('engineeringPalette').value = 'custom'; });
$('engineeringPaletteName').addEventListener('input', () => { $('engineeringPalette').value = 'custom'; });
$('engineeringLibraryScope').addEventListener('change', renderEngineeringLinks);
$('engineeringLibraryGroups').addEventListener('change', renderEngineeringLinks);
$('engineeringSafeMode').addEventListener('change', renderEngineeringLinks);
$('exportEngineeringManifestBtn').addEventListener('click', () => {
  download(JSON.stringify(engineeringManifest(), null, 2), 'protolab-library-manifest.json', 'application/json'); notify(t('轻量组件清单已导出'));
});
function installProject(next) {
  // 先原子写入完整工程集合，再切换内存；写入失败保留当前工程。
  writeStorage(PROJECTS_KEY, next);
  catalog = next;
  projectSession++;
  const entry = currentRecord();
  project = withPages(entry.project); library = completeLibrary(entry.library); libraryGroups = entry.libraryGroups || []; groupFilter = 'all';
  assistant.activate(project, entry.workspace);
  selectedId = null; selectedIds.clear();
  history = projectHistories.get(entry.id) || createHistory({ project, library, libraryGroups });
  projectHistories.set(entry.id, history);
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('componentSearch').value = ''; renderProjects(); setLibraryTab('basic'); renderCanvas(); fitCanvas(); persistProject();
  notify(t`已切换到「${entry.name}」${entry.workspace.pending ? t('，有 AI 版本等待合并') : ''}`);
}
$('newProjectBtn').addEventListener('click', () => openProjectDetails(true));
$('engineeringSettingsBtn').addEventListener('click', () => openProjectDetails(false));
$('projectSelect').addEventListener('change', safeAction(() => {
  const id = $('projectSelect').value;
  if (id === catalog.activeId) return;
  try {
    finishGesture();
    if (!persistProject()) throw new Error(t('当前工程保存失败，已保留当前工程，请先导出备份'));
    installProject(activateProject(catalog, id));
  } finally { $('projectSelect').value = catalog.activeId; }
}));
$('engineeringForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const details = projectDetails({ name: $('engineeringName').value, rules: $('engineeringRules').value, design: readEngineeringDesign() });
    finishGesture();
    if (!persistProject()) throw new Error(t('当前工程保存失败，请先导出备份，再新建或更改工程设置'));
    if ($('engineeringForm').dataset.create === 'true') {
      const entry = projectRecord(details, emptyProject($('engineeringPreset').value), clone(COMPONENTS));
      installProject(appendProject(catalog, entry));
    } else {
      const next = saveActiveProject(catalog, details);
      writeStorage(PROJECTS_KEY, next); catalog = next; renderProjects(); $('engineeringDialog').close(); notify(t('工程设置及配色、组件库、安全区关联已保存'));
    }
  } catch (error) { $('engineeringError').textContent = t(error.message); }
});
try { guides = readStorage(GUIDES_KEY, normalizeGuides) || guides; }
catch { startupWarnings.push(t('辅助线设置读取失败，已使用默认设置')); }
const itemNodes = new Map();
const selectedItem = () => project.items.find(item => item.id === selectedId);
const selectionStarts = () => new Map(project.items.filter(item => selectedIds.has(item.id)).map(item => [item.id, { x: item.x, y: item.y }]));

function renderLibrary() {
  const query = $('componentSearch').value.trim().toLowerCase();
  if (groupFilter !== 'all' && groupFilter !== '' && !libraryGroups.some(group => group.id === groupFilter)) groupFilter = 'all';
  $('customGroupFilter').replaceChildren(new Option(t('全部分组'), 'all'), new Option(t('未分组'), ''), ...libraryGroups.map(group => new Option(group.name, group.id)));
  $('customGroupFilter').value = groupFilter;
  $('manageGroupBtn').disabled = !libraryGroups.some(group => group.id === groupFilter);
  $('customList').querySelectorAll('.component-preview').forEach(clearComponentPreview);
  $('presetList').replaceChildren(); $('vectorList').replaceChildren(); $('customList').replaceChildren();
  const displayName = component => component.builtin ? t(component.name) : component.name;
  const visible = library.filter(component => [component.name, displayName(component), component.builtin ? translate(component.name, [], 'en') : ''].some(name => name.toLowerCase().includes(query)) && (component.builtin || groupFilter === 'all' || (libraryGroups.some(group => group.id === component.groupId) ? component.groupId : '') === groupFilter));
  for (const component of visible) {
    const button = document.createElement('button');
    button.className = 'component-item'; button.draggable = true; button.type = 'button';
    button.dataset.compId = component.id;
    button.title = t`添加${displayName(component)}（${component.defaultWidth} × ${component.defaultHeight}）`;
    const symbol = component.builtin && component.type === 'svg' ? component.content : icon(componentIcon(component));
    if (component.builtin) {
      button.innerHTML = `<span class="component-symbol">${symbol}</span><span class="component-name">${escapeHTML(displayName(component))}</span><span class="drag-dots" aria-hidden="true">⠿</span>`;
    } else {
      button.classList.add('custom-component');
      button.innerHTML = `<span class="component-preview" aria-hidden="true"></span><span class="component-card-meta"><span class="component-name">${escapeHTML(component.name)}</span><span class="drag-dots" aria-hidden="true">⠿</span></span>`;
    }
    if (component.builtin) $(component.type === 'svg' ? 'vectorList' : 'presetList').append(button);
    else {
      const card = document.createElement('div'); card.className = 'custom-entry';
      const footer = document.createElement('div'); footer.className = 'custom-entry-footer';
      const group = document.createElement('span'); group.dataset.i18nIgnore = ''; group.textContent = libraryGroups.find(group => group.id === component.groupId)?.name || t('未分组');
      const manage = document.createElement('button'); manage.type = 'button'; manage.className = 'btn btn-sm'; manage.dataset.manageComponent = component.id; manage.textContent = t('管理'); manage.setAttribute('aria-label', t`管理${component.name}`);
      footer.append(group, manage); card.append(button, footer); $('customList').append(card);
      renderComponentPreview(button.querySelector('.component-preview'), component);
    }
  }
  const customCount = library.filter(component => !component.builtin).length;
  $('libCount').textContent = library.length;
  $('customCount').textContent = query || groupFilter !== 'all' ? visible.filter(component => !component.builtin).length : customCount;
  $('basicCount').textContent = visible.filter(component => component.builtin && component.type !== 'svg').length;
  $('vectorCount').textContent = visible.filter(component => component.builtin && component.type === 'svg').length;
  const count = visible.filter(component => libraryCategory(component) === libraryTab).length;
  $('libraryEmpty').hidden = count > 0 || libraryTab === 'custom';
  $('customEmpty').hidden = visible.some(component => !component.builtin);
  $('customEmpty').textContent = query ? t('没有找到匹配的自定义组件') : groupFilter !== 'all' ? t('此分组暂无组件，可新建或导入。') : t('把常用的设计，变成自己的组件。');
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
  $('menuDuplicateBtn').disabled = !item;
  $('menuDeleteBtn').disabled = !item;
  $('saveSelectionComponentBtn').disabled = !item;
  $('noSelectionMsg').hidden = !!item;
  $('selectionProps').hidden = !item;
  $('selectionCount').textContent = selectedIds.size ? t`已选 ${selectedIds.size} 个` : t('未选中');
  const disabled = !selectedIds.size || $('alignReference').value === 'selection' && selectedIds.size < 2;
  $('alignmentActions').querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  if (!item) return;
  $('selectionDetail').textContent = selectedIds.size > 1 ? t`已选 ${selectedIds.size} 个组件，以下属性仅编辑「${item.name}」；拖动、复制、删除作用于全部所选组件。` : t('按住 Shift 点击组件可多选并对齐。');
  for (const [field, key] of Object.entries({ propName: 'name', propX: 'x', propY: 'y', propW: 'width', propH: 'height', propRadius: 'radius' })) $(field).value = item[key];
  $('propY').value = visibilityLayout(project.items).find(value => value.id === item.id).y;
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
  for (const option of $('propImageFit').options) option.disabled = propertyContent.images.some(image => image.vector) && ['none', 'scale-down'].includes(option.value);
  $('propImageTarget').replaceChildren(...propertyContent.images.map(({ label }, index) => new Option(label, String(index))));
  $('propImageFile').value = ''; renderPropertyImage();
  const response = normalizeOrientationResponse(item.orientationResponse);
  $('propOrientationEnabled').checked = response.enabled;
  $('propPortraitAction').value = response.portrait; $('propLandscapeAction').value = response.landscape;
  updateOrientationFields('prop');
  $('propClickAction').value = item.interaction?.type || 'none';
  $('propVisible').checked = item.visible !== false;
  $('propCollapseSpace').checked = item.collapseSpace !== false;
  $('propVisibilityMode').value = item.interaction?.mode || 'toggle';
  $('propToastDuration').value = item.interaction?.duration || 2500;
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
$('propBlendMode').replaceChildren(...Object.entries(BLEND_MODES).map(([value, label]) => new Option(t(label), value)));
$('propImageFit').append(...Object.entries(IMAGE_FITS).map(([value, label]) => new Option(t(label), value)));
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
  if (session !== projectSession || selectedItem() !== item) throw new Error(t('所选组件已变化，请重新设置图片'));
  pendingImages.set(index, source); renderPropertyImage();
  notify(t('图片已准备好，点击应用属性保存'));
}));
function renderInteractionTargets(targetId = $('propClickTarget').value) {
  const type = $('propClickAction').value;
  const needsTarget = ['navigate', 'openPopup', 'showToast'].includes(type);
  $('propClickTargetField').hidden = !needsTarget;
  $('propClickTarget').required = needsTarget;
  $('propClickTarget').disabled = !needsTarget;
  const kind = { navigate: 'page', openPopup: 'popup', showToast: 'toast' }[type];
  const targets = project.pages.filter(page => page.kind === kind);
  $('propClickTarget').replaceChildren(new Option(t('请选择目标'), ''), ...targets.map(page => new Option(page.name, page.id)));
  $('propClickTarget').value = targets.some(page => page.id === targetId) ? targetId : '';
  $('propToastDurationField').hidden = type !== 'showToast';
  $('propToastDuration').disabled = type !== 'showToast';
  $('propToastDuration').required = type === 'showToast';
  $('propVisibilityFields').hidden = type !== 'visibility';
  $('propVisibilityMode').disabled = type !== 'visibility';
  const selected = selectedItem()?.interaction?.targetIds || [];
  $('propVisibilityTargets').replaceChildren(...project.items.map(item => {
    const label = document.createElement('label'); label.className = 'checkbox-field';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
    input.checked = selected.includes(item.id); input.disabled = type !== 'visibility';
    label.append(input, document.createTextNode(item.name)); return label;
  }));
  $('interactionHelp').textContent = needsTarget && !targets.length ? t`请先在页面管理中新建${t(PAGE_KINDS[kind])}。` : type === 'visibility' ? t('目标限于当前页面；多选元素可以一起展开或收起整个板块。') : t('在预览和导出的 HTML 中点击组件执行动作。');
}
function readInteraction() {
  return normalizeInteraction({ type: $('propClickAction').value, targetId: $('propClickTarget').value,
    duration: $('propToastDuration').value, mode: $('propVisibilityMode').value,
    targetIds: [...$('propVisibilityTargets').querySelectorAll('input:checked')].map(input => input.value) });
}
$('propClickAction').replaceChildren(...Object.entries(INTERACTIONS).map(([value, label]) => new Option(t(label), value)));
$('propClickAction').addEventListener('change', () => renderInteractionTargets(''));
function renderPages() {
  const onlyPage = project.pages.filter(page => page.kind === 'page').length === 1;
  $('pageList').replaceChildren(...project.pages.map(page => {
    const entry = document.createElement('div'); entry.className = 'page-tab-entry';
    const button = document.createElement('button');
    button.type = 'button'; button.className = `page-tab${page.id === project.activePageId ? ' active' : ''}`;
    button.dataset.pageId = page.id; button.setAttribute('aria-pressed', String(page.id === project.activePageId));
    button.textContent = `${page.kind !== 'page' ? `${t(PAGE_KINDS[page.kind])} · ` : ''}${page.name}${page.id === project.startPageId ? t(' · 首页') : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'page-tab-delete'; remove.dataset.deletePageId = page.id;
    remove.textContent = '×'; remove.setAttribute('aria-label', t`删除「${page.name}」`);
    remove.disabled = page.kind === 'page' && onlyPage;
    remove.title = remove.disabled ? t('至少保留一个普通页面') : t`删除「${page.name}」`;
    entry.append(button, remove); return entry;
  }));
  const page = activePage(project);
  $('artboardName').textContent = page.name;
  $('pageSummary').textContent = Object.entries(PAGE_KINDS).map(([kind, label]) => `${project.pages.filter(page => page.kind === kind).length} ${t(label)}`).join(' · ');
}
function applyPageChange(next, label) {
  project = next; selectedId = null; selectedIds.clear(); commit(label);
}
$('pageList').addEventListener('click', safeAction(event => {
  const remove = event.target.closest('[data-delete-page-id]');
  if (remove) { requestPageDeletion(remove.dataset.deletePageId); return; }
  const button = event.target.closest('[data-page-id]');
  if (!button || button.dataset.pageId === project.activePageId) return;
  finishGesture(); applyPageChange(switchPage(project, button.dataset.pageId), t('切换编辑页面'));
}));
for (const [id, kind] of [['addPageBtn', 'page'], ['addPopupBtn', 'popup'], ['addToastBtn', 'toast']]) $(id).addEventListener('click', safeAction(() => {
  finishGesture(); applyPageChange(addPage(project, kind), t`新增${t(PAGE_KINDS[kind])}`);
  notify(t`已新增${t(PAGE_KINDS[kind])}`);
}));
let managedPageId = null;
const PAGE_DELETE_CONFIRMATION_KEY = 'protolab.skipPageDeleteConfirmation';
let skipPageDeleteConfirmation = false;
try { skipPageDeleteConfirmation = localStorage.getItem(PAGE_DELETE_CONFIRMATION_KEY) === 'true'; } catch { /* 存储不可用时仍显示确认。 */ }
let pendingPageDeletion = null;
function performPageDeletion(id) {
  finishGesture(); applyPageChange(deletePage(project, id), t('删除页面或弹窗'));
  if ($('pageDialog').open) $('pageDialog').close();
  notify(t('已删除，关联跳转已清除，可撤销恢复'));
}
function requestPageDeletion(id) {
  const page = project.pages.find(page => page.id === id);
  if (!page) return;
  if (page.kind === 'page' && project.pages.filter(page => page.kind === 'page').length === 1) {
    notify(t('至少保留一个普通页面'), true); return;
  }
  if (skipPageDeleteConfirmation) { performPageDeletion(id); return; }
  finishGesture(); pendingPageDeletion = { id, session: projectSession };
  $('deletePageDescription').textContent = t`确认删除「${page.name}」？关联动作将被清除，删除后可撤销恢复。`;
  $('skipPageDeleteConfirmation').checked = false;
  $('deletePageDialog').showModal();
}
$('deletePageDialog').addEventListener('close', () => { pendingPageDeletion = null; });
$('deletePageForm').addEventListener('submit', safeAction(event => {
  event.preventDefault();
  if (!pendingPageDeletion || pendingPageDeletion.session !== projectSession) { $('deletePageDialog').close(); return; }
  performPageDeletion(pendingPageDeletion.id);
  if ($('skipPageDeleteConfirmation').checked) {
    skipPageDeleteConfirmation = true;
    try { localStorage.setItem(PAGE_DELETE_CONFIRMATION_KEY, 'true'); } catch { /* 当前会话仍记住选择。 */ }
  }
  $('deletePageDialog').close();
}));
$('managePageBtn').addEventListener('click', () => {
  finishGesture(); const page = activePage(project); managedPageId = page.id;
  $('pageName').value = page.name; $('pageError').textContent = '';
  $('pageStart').checked = page.id === project.startPageId; $('pageStart').disabled = page.kind !== 'page';
  $('deletePageBtn').disabled = page.kind === 'page' && project.pages.filter(page => page.kind === 'page').length === 1;
  $('pageDialog').showModal();
});
$('pageForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('pageName').value.trim();
  if (!name) { $('pageError').textContent = t('请输入页面名称'); return; }
  const page = project.pages.find(page => page.id === managedPageId);
  page.name = name;
  if (page.kind === 'page' && $('pageStart').checked) project.startPageId = page.id;
  commit(t('更新页面名称与首页')); $('pageDialog').close(); saveProject(t('保存页面设置'));
});
$('duplicatePageBtn').addEventListener('click', safeAction(() => {
  applyPageChange(addPage(project, 'page', true), t('复制页面或弹窗')); $('pageDialog').close();
}));
$('deletePageBtn').addEventListener('click', safeAction(() => requestPageDeletion(managedPageId)));
function renderLayers() {
  $('layerList').replaceChildren();
  for (const item of [...project.items].reverse()) {
    const button = document.createElement('button');
    button.className = `layer-item${selectedIds.has(item.id) ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selectedIds.has(item.id)));
    button.dataset.itemId = item.id;
    const hidden = orientationPresentation(item, project.canvas).hidden;
    button.innerHTML = `${icon(item.type === 'image' ? 'image' : item.type === 'svg' ? 'star' : 'layers')}<span>${escapeHTML(item.name)}${hidden ? item.visible === false ? t(' · 初始隐藏') : t(' · 当前方向隐藏') : ''}</span>`;
    $('layerList').append(button);
  }
  $('layerCount').textContent = project.items.length;
  $('layerEmpty').hidden = project.items.length > 0;
  $('layerActions').hidden = !selectedItem();
  const index = project.items.findIndex(item => item.id === selectedId);
  $('layerUpBtn').disabled = index === project.items.length - 1;
  $('layerDownBtn').disabled = index <= 0;
}
const CANVAS_CAPTION_HEIGHT = 28;
function updateZoom() {
  const layout = frameLayout(project.canvas, project.frame);
  const inset = guides.rulers ? 22 : 0;
  $('canvasScaler').style.transform = `scale(${zoom})`;
  $('canvasScaler').style.left = `${inset}px`;
  $('canvasScaler').style.top = `${CANVAS_CAPTION_HEIGHT + inset}px`;
  $('canvasCaption').style.left = `${inset + layout.left * zoom}px`;
  $('canvasCaption').style.width = `${project.canvas.width * zoom}px`;
  $('canvasStage').style.width = `${layout.width * zoom + inset}px`;
  $('canvasStage').style.height = `${layout.height * zoom + CANVAS_CAPTION_HEIGHT + inset}px`;
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
    ruler.style.top = vertical ? `${CANVAS_CAPTION_HEIGHT + 22 + layout.top * zoom}px` : `${CANVAS_CAPTION_HEIGHT}px`;
    ruler.innerHTML = rulerMarkup(length, zoom, vertical);
  }
}
function updateGuides() {
  const next = normalizeGuides({ rulers: $('showRulers').checked, grid: $('showGrid').checked, snap: $('snapComponents').checked, gridSize: Number($('gridSize').value) });
  finishGesture();
  guides = next;
  updateZoom();
  try { writeStorage(GUIDES_KEY, guides); }
  catch { notify(t('辅助线设置未保存，浏览器存储不可用或已满'), true); }
}
for (const id of ['showRulers', 'showGrid', 'gridSize', 'snapComponents']) $(id).addEventListener('change', updateGuides);
function renderSafeArea() {
  $('safeAreaError').textContent = '';
  const area = project.safeArea;
  const bounds = placementBounds(project);
  $('safeAreaEnabled').checked = area.enabled;
  for (const side of ['top', 'right', 'bottom', 'left']) $(`safe${side[0].toUpperCase()}${side.slice(1)}`).value = area[side];
  $('safeAreaSummary').textContent = area.enabled ? t`可放置区域：${bounds.width} × ${bounds.height} px，起点 (${bounds.x}, ${bounds.y})` : t('安全区限制已关闭');
  $('canvasSafeArea').hidden = !area.enabled;
  Object.assign($('canvasSafeArea').style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
}
function applySafeArea(event) {
  event.preventDefault();
  if (event.type === 'change' && !$('safeAreaEnabled').checked) {
    finishGesture(); project.safeArea = { ...project.safeArea, enabled: false };
    commit(); notify(t('安全区限制已关闭')); return;
  }
  if (!$('safeAreaForm').reportValidity()) { $('safeAreaEnabled').checked = project.safeArea.enabled; return; }
  const raw = { enabled: $('safeAreaEnabled').checked };
  for (const side of ['top', 'right', 'bottom', 'left']) raw[side] = Number($(`safe${side[0].toUpperCase()}${side.slice(1)}`).value);
  const bars = systemBarInsets(project.frame, project.canvas);
  if (raw.left + raw.right >= project.canvas.width || raw.top + raw.bottom >= project.canvas.height - bars.top - bars.bottom) {
    $('safeAreaError').textContent = t('左右或上下留白总和过大，请至少保留 1 px 的可放置区域');
    $('safeAreaEnabled').checked = project.safeArea.enabled;
    return;
  }
  finishGesture();
  project.safeArea = normalizeSafeArea(raw, project.canvas, project.frame);
  project = constrainProject(project, true);
  $('safeAreaError').textContent = '';
  commit(); notify(raw.enabled ? t('安全区已应用，组件已约束在可放置区域内') : t('安全区限制已关闭'));
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
  $('frameStyle').replaceChildren(...Object.entries({ none: t('无外框'), ...FRAME_STYLES[frame.device], custom: t('自定义 HTML') }).map(([value, label]) => new Option(t(label), value)));
  $('frameStyle').value = frame.style;
  $('cameraSettings').hidden = frame.device !== 'phone' || frame.style === 'classic';
  $('cameraStyle').replaceChildren(...Object.entries(CAMERA_STYLES).map(([value, label]) => new Option(t(label), value)));
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
  $('presetLabel').textContent = `${t(PRESETS[canvas.preset]?.label || '自定义')} · ${canvas.width > canvas.height ? t('横屏') : t('竖屏')}`;
  document.querySelectorAll('[data-preset]').forEach(button => { const active = button.dataset.preset === canvas.preset; button.classList.toggle('active', active); button.setAttribute('aria-checked', String(active)); });
  const ids = new Set(project.items.map(item => item.id));
  for (const [id, node] of itemNodes) if (!ids.has(id)) { node.remove(); itemNodes.delete(id); }
  const displayed = visibilityLayout(project.items);
  for (const item of project.items) {
    let node = itemNodes.get(item.id);
    if (!node) { node = document.createElement('div'); node.dataset.itemId = item.id; itemNodes.set(item.id, node); }
    node.className = `editor-item${selectedIds.has(item.id) ? ' selected' : ''}`;
    Object.assign(node.style, { left: `${item.x}px`, top: `${displayed.find(value => value.id === item.id).y}px`, width: `${item.width}px`, height: `${item.height}px`, borderRadius: `${item.radius}px` });
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
  $('componentCount').textContent = t`${project.items.length} 个组件`;
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
  if (selectedId) setPropertiesTab('component');
  for (const [key, node] of itemNodes) node.classList.toggle('selected', selectedIds.has(key));
  renderProperties(); renderLayers();
}
function commit(label = t('修改设计')) {
  project = constrainProject(withPages(project)); history.push({ project, library, libraryGroups }, label);
  renderCanvas(); assistant.refreshVersions(); assistant.refreshRules(); renderHistory(); scheduleSave();
}
function saveProject(label = t('手动保存')) {
  finishGesture(); assistant.saveVersion(label);
  if (persistProject()) { $('saveState').textContent = t('已保存版本'); notify(t('已保存，并生成版本记录')); }
}
function renderHistory() {
  $('historyList').replaceChildren(...history.entries.map((entry, index) => {
    const row = document.createElement('div'); row.className = `version-row${index === history.cursor ? ' current' : ''}`;
    const info = document.createElement('div'); const title = document.createElement('strong');
    title.textContent = `${index + 1} · ${t(entry.label)}${index === history.cursor ? t(' · 当前') : ''}`;
    const meta = document.createElement('small'); meta.textContent = new Date(entry.createdAt).toLocaleString(getLocale());
    const button = document.createElement('button'); button.className = 'btn btn-sm'; button.textContent = index > history.cursor ? t('重做到此步骤') : t('撤回到此步骤'); button.disabled = index === history.cursor;
    button.addEventListener('click', () => restore(index)); info.append(title, meta); row.append(info, button); return row;
  }).toReversed());
}
function add(component, x = 40, y = 40, snap = false) {
  if (project.items.length >= MAX_ITEMS) throw new Error(t('单个画布最多 200 个组件'));
  const item = createItem(component, project.canvas, x, y, placementBounds(project));
  project.items.push(item); selectedId = item.id; selectedIds = new Set([item.id]);
  setPropertiesTab('component');
  if (snap) project = snapItems(project, new Map([[item.id, { x: item.x, y: item.y }]]), 0, 0, zoom).project;
  commit(t`添加组件：${item.name}`); notify(t`已添加「${item.name}」`);
}
function removeSelected() {
  if (!selectedItem()) return;
  project.items = cleanVisibilityTargets(project.items.filter(item => !selectedIds.has(item.id)));
  selectedId = null; selectedIds.clear(); commit(t('删除组件')); notify(t('已删除所选组件，可撤销恢复'));
}
function duplicateSelected() {
  const item = selectedItem();
  if (!item) return;
  if (project.items.length + selectedIds.size > MAX_ITEMS) throw new Error(t('单个画布最多 200 个组件'));
  const moved = moveItems(project, selectionStarts(), 16, 16);
  const copies = copyItems(moved.items.filter(value => selectedIds.has(value.id))).map(value => normalizeItem({ ...value, name: t`${value.name} 副本` }, project.canvas, itemBounds(project)));
  project.items.push(...copies); selectedIds = new Set(copies.map(value => value.id)); selectedId = copies.at(-1).id; commit(t('复制组件')); notify(t('已复制所选组件'));
}
function restore(direction) {
  finishGesture();
  const state = typeof direction === 'number' ? history.checkout(direction) : direction === 'undo' ? history.undo() : history.redo();
  project = state.project; library = state.library; libraryGroups = state.libraryGroups || [];
  assistant.refreshVersions(); renderHistory(); renderLibrary();
  if (!selectedItem()) selectedId = null;
  renderCanvas(); scheduleSave();
}
function finishGesture(cancel = false) {
  renderSnapGuides();
  if (!gesture) return;
  const old = gesture; gesture = null;
  const changed = project.items.some(item => old.starts.has(item.id) && (item.x !== old.starts.get(item.id).x || item.y !== old.starts.get(item.id).y));
  if (cancel) { project = moveItems(project, old.starts, 0, 0); renderCanvas(); }
  else if (changed) commit(t('移动组件'));
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
  commit(button.textContent); notify(t`已${button.textContent}（参照${$('alignReference').value === 'canvas' ? t('画布') : t('所选组件')}）`);
});
function changeLayer(delta) {
  const index = project.items.findIndex(item => item.id === selectedId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= project.items.length) return;
  [project.items[index], project.items[target]] = [project.items[target], project.items[index]];
  commit(t('调整图层顺序'));
}
$('layerUpBtn').addEventListener('click', () => changeLayer(1)); $('layerDownBtn').addEventListener('click', () => changeLayer(-1));
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  finishGesture();
  const key = button.dataset.preset;
  project = resizeProject(project, PRESETS[key].width, PRESETS[key].height, key); commit(t('切换画布预设'));
}));
$('rotateBtn').addEventListener('click', () => { finishGesture(); project = rotateProject(project); commit(t('旋转画布')); });
$('canvasSizeForm').addEventListener('submit', event => { event.preventDefault(); finishGesture(); project = resizeProject(project, $('canvasWidthInput').value, $('canvasHeightInput').value); commit(t('调整画布尺寸')); notify(t('画布尺寸已更新')); });
function updateFrame(changes) {
  finishGesture();
  project.frame = normalizeFrame({ ...project.frame, ...changes }, 'custom', sanitizeContent);
  commit(t('修改设备外框'));
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
    if (!html.trim()) throw new Error(t('请输入可用的外框 HTML'));
    const insets = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, $(`frame${side[0].toUpperCase()}${side.slice(1)}`).value]));
    updateFrame({ style: 'custom', html, insets });
    $('frameDialog').close(); notify(t('自定义外框已应用'));
  } catch (error) { $('frameError').textContent = t(error.message); }
});
$('showStatusBar').addEventListener('change', () => updateFrame({ statusBar: $('showStatusBar').checked }));
$('navigationStyle').addEventListener('change', () => updateFrame({ navigation: $('navigationStyle').value }));
$('statusTime').addEventListener('change', safeAction(() => {
  const time = $('statusTime').value;
  if (!/^\d{1,2}:\d{2}$/.test(time) || Number(time.split(':')[0]) > 23 || Number(time.split(':')[1]) > 59) { renderDevice(); throw new Error(t('时间请输入 0:00～23:59')); }
  updateFrame({ time });
}));
$('statusBattery').addEventListener('change', () => updateFrame({ battery: $('statusBattery').value }));
$('selectionProps').addEventListener('submit', safeAction(async event => {
  event.preventDefault(); const item = selectedItem(); if (!item) return;
  const session = projectSession, images = [...pendingImages.values()];
  let content = updateTextContent(item, [...$('textContentFields').querySelectorAll('[data-text-index]')].map(input => input.value));
  for (const [index, source] of pendingImages) content = updateImageContent({ ...item, content }, index, source);
  if (!contentSizeValid(content, item.type)) throw new Error(t('组件内容过大，请使用较小图片或独立图片组件'));
  const displayed = visibilityLayout(project.items).find(value => value.id === item.id);
  const geometryChanged = Object.entries({ propX: 'x', propY: 'y', propW: 'width', propH: 'height' }).some(([field, key]) => Number($(field).value) !== displayed[key]);
  const y = Number($('propY').value) === displayed.y ? item.y : expandedY(project.items, item.id, Number($('propY').value));
  const next = normalizeItem({ ...item, content, appearance: readPropertyAppearance(), name: $('propName').value.trim(), visible: $('propVisible').checked, collapseSpace: $('propCollapseSpace').checked, x: $('propX').value, y, width: $('propW').value, height: $('propH').value, radius: $('propRadius').value, padding: readPropertySpacing('Padding'), margin: readPropertySpacing('Margin'), orientationResponse: readOrientationFields('prop'), interaction: readInteraction() }, project.canvas, geometryChanged && !project.items.some(value => value.visible === false) ? placementBounds(project) : itemBounds(project));
  for (const source of images) {
    const image = new Image(); image.src = source;
    try { await image.decode(); } catch { throw new Error(t('图片内容无效，无法读取')); }
  }
  if (session !== projectSession || selectedItem() !== item) throw new Error(t('所选组件已变化，请重新应用属性'));
  project.items[project.items.indexOf(item)] = next;
  commit(t('修改组件属性')); notify(t('组件属性已更新'));
}));
$('deleteItemBtn').addEventListener('click', removeSelected);
$('duplicateItemBtn').addEventListener('click', safeAction(duplicateSelected));
$('menuDeleteBtn').addEventListener('click', removeSelected);
$('menuDuplicateBtn').addEventListener('click', safeAction(duplicateSelected));
$('undoBtn').addEventListener('click', () => restore('undo')); $('redoBtn').addEventListener('click', () => restore('redo'));
$('zoomSelect').addEventListener('change', () => { finishGesture(); zoom = Number($('zoomSelect').value); updateZoom(); });
const viewportPan = attachViewportPan($('canvasViewport'), {
  beforePan: () => finishGesture(true),
  onBlankClick: target => { if (target.closest('#canvas')) select(null); }
});
attachViewportZoom($('canvasViewport'), $('canvasScaler'), {
  getZoom: () => zoom,
  setZoom: value => { zoom = value; updateZoom(); },
  beforeZoom: () => { viewportPan.cancel(); finishGesture(true); }
});
function fitCanvas() {
  const layout = frameLayout(project.canvas, project.frame);
  const viewport = $('canvasViewport');
  const computed = getComputedStyle(viewport);
  const availableWidth = viewport.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight) - (guides.rulers ? 22 : 0);
  const availableHeight = viewport.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom) - CANVAS_CAPTION_HEIGHT - (guides.rulers ? 22 : 0);
  zoom = Math.max(.1, Math.min(1, Math.floor(Math.min(availableWidth / layout.width, availableHeight / layout.height) * 100) / 100));
  updateZoom();
}
$('fitBtn').addEventListener('click', fitCanvas);
$('menuFitBtn').addEventListener('click', fitCanvas);
$('saveBtn').addEventListener('click', () => saveProject());
$('historyBtn').addEventListener('click', () => { finishGesture(); renderHistory(); });
$('saveLibBtn').addEventListener('click', () => { finishGesture(); assistant.saveVersion(t('保存组件库')); if (persistLibrary()) notify(t('组件库已保存到当前浏览器')); });
$('exportLibBtn').addEventListener('click', () => { download(JSON.stringify({ version: 1, components: library, groups: libraryGroups }, null, 2), 'protolab-library.json', 'application/json'); notify(t('组件库 JSON 已导出')); });
$('exportProjectBtn').addEventListener('click', safeAction(() => {
  finishGesture(); download(projectFile(project, library, projectDetails(currentRecord()), libraryGroups), 'protolab-project.json', 'application/json'); notify(t('工程已导出，包含画布、设备设置、自定义组件及工程规范'));
}));
$('importProjectBtn').addEventListener('click', () => {
  $('projectForm').reset(); $('projectError').textContent = ''; $('projectDialog').showModal();
});
$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('projectFileInput').files[0]; if (!file || $('applyProjectImportBtn').disabled) return;
  const button = $('applyProjectImportBtn'); button.disabled = true; button.textContent = t('正在识别组件…'); $('projectError').textContent = '';
  const sourceSession = projectSession;
  try {
    const imported = await importProjectFile(file, { width: Number($('importWidth').value), height: Number($('importHeight').value) }, readFile);
    if (sourceSession !== projectSession) throw new Error(t('工程已切换，请在目标工程重新导入'));
    const nextLibrary = imported.components ? completeLibrary(imported.components) : library;
    finishGesture(); project = imported.project; library = nextLibrary; if (imported.components) libraryGroups = imported.groups || [];
    selectedId = null; selectedIds.clear(); commit(t('导入工程')); renderLibrary();
    if (imported.details) { catalog = saveActiveProject(catalog, imported.details); renderProjects(); }
    if (imported.components) persistLibrary();
    persistProject(); fitCanvas(); $('projectDialog').close();
    notify(t`工程已导入，识别 ${project.items.length} 个组件${imported.warnings.length ? `；${imported.warnings.join('；')}` : ''}`);
  } catch (error) { $('projectError').textContent = t(error.message) || t('工程导入失败'); }
  finally { button.disabled = false; button.textContent = t('导入并替换画布'); }
});
$('importLibBtn').addEventListener('click', () => $('libFileInput').click());
function fillGroupSelect(select, value = '') {
  select.replaceChildren(new Option(t('未分组'), ''), ...libraryGroups.map(group => new Option(group.name, group.id)));
  select.value = libraryGroups.some(group => group.id === value) ? value : '';
}
function saveLibraryChange(label) {
  commit(label); renderLibrary(); persistLibrary();
}
function installLibraryImport(incoming, groups, label) {
  const merged = mergeLibrary(library, libraryGroups, incoming, groups);
  const nextLibrary = validateLibrary(merged.components, sanitizeContent);
  finishGesture(); library = nextLibrary; libraryGroups = merged.groups; groupFilter = 'all';
  saveLibraryChange(label); setLibraryTab('custom'); notify(t('已合并导入组件，现有组件与分组已保留'));
}
$('customGroupFilter').addEventListener('change', () => { groupFilter = $('customGroupFilter').value; renderLibrary(); });
function openGroupDialog(id = '') {
  const group = libraryGroups.find(group => group.id === id);
  $('groupForm').dataset.groupId = group?.id || ''; $('groupName').value = group?.name || '';
  $('groupDialogTitle').textContent = group ? t('管理分组') : t('新建分组');
  $('deleteGroupBtn').hidden = !group; $('groupError').textContent = '';
  $('groupDialog').showModal(); $('groupName').focus();
}
$('newGroupBtn').addEventListener('click', () => openGroupDialog());
$('manageGroupBtn').addEventListener('click', () => openGroupDialog(groupFilter));
$('groupForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const id = $('groupForm').dataset.groupId, name = $('groupName').value.trim();
    const next = validateGroups(id ? libraryGroups.map(group => group.id === id ? { ...group, name } : group) : [...libraryGroups, { id: uid(), name }]);
    finishGesture(); libraryGroups = next; groupFilter = id || next.at(-1).id;
    saveLibraryChange(id ? t('重命名组件分组') : t('新建组件分组')); $('groupDialog').close();
  } catch (error) { $('groupError').textContent = t(error.message); }
});
$('deleteGroupBtn').addEventListener('click', () => {
  const id = $('groupForm').dataset.groupId;
  if (!confirm(t('删除此分组？其中的组件会保留并移到未分组，可撤销。'))) return;
  finishGesture(); libraryGroups = libraryGroups.filter(group => group.id !== id);
  library = library.map(component => component.groupId === id ? { ...component, groupId: '' } : component);
  groupFilter = ''; saveLibraryChange(t('删除组件分组')); $('groupDialog').close();
});
$('customList').addEventListener('click', event => {
  const button = event.target.closest('[data-manage-component]'); if (!button) return;
  const component = library.find(component => component.id === button.dataset.manageComponent);
  if (!component) return;
  $('manageComponentForm').dataset.componentId = component.id;
  $('manageComponentName').value = component.name; fillGroupSelect($('manageComponentGroup'), component.groupId);
  $('manageComponentError').textContent = ''; $('manageComponentDialog').showModal(); $('manageComponentName').focus();
});
$('manageComponentForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const id = $('manageComponentForm').dataset.componentId;
    const name = $('manageComponentName').value.trim(); if (!name) throw new Error(t('请输入组件名称'));
    const next = validateLibrary(library.map(component => component.id === id ? { ...component, name, groupId: $('manageComponentGroup').value } : component), sanitizeContent);
    finishGesture(); library = next; saveLibraryChange(t('修改组件名称与分组')); $('manageComponentDialog').close();
  } catch (error) { $('manageComponentError').textContent = t(error.message); }
});
$('deleteCustomComponentBtn').addEventListener('click', () => {
  if (!confirm(t('删除此自定义组件？画布中已有的组件会保留，可撤销。'))) return;
  finishGesture(); library = library.filter(component => component.id !== $('manageComponentForm').dataset.componentId);
  saveLibraryChange(t('删除自定义组件')); $('manageComponentDialog').close();
});
$('exportComponentBtn').addEventListener('click', () => {
  const component = library.find(component => component.id === $('manageComponentForm').dataset.componentId);
  if (!component) return;
  const groups = libraryGroups.filter(group => group.id === component.groupId);
  download(JSON.stringify({ version: 1, components: [component], groups }, null, 2), 'protolab-component.json', 'application/json');
});
$('importComponentBtn').addEventListener('click', () => $('componentFileInput').click());
$('componentFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > MAX_LIBRARY_BYTES) throw new Error(t('组件文件不能超过十二兆字节'));
  const sourceSession = projectSession, sourceFilter = groupFilter;
  const content = await readFile(file);
  if (sourceSession !== projectSession) throw new Error(t('工程已切换，请重新导入组件'));
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    const raw = JSON.parse(content);
    const values = Array.isArray(raw) || raw?.components ? raw : [raw?.component || raw];
    const components = validateLibrary(values, sanitizeContent).map(component => ({ ...component, builtin: false }));
    const groups = validateGroups(raw?.groups);
    // 未携带分组的单组件文件归入当前分组。
    if (!groups.length && libraryGroups.some(group => group.id === sourceFilter)) {
      groups.push(libraryGroups.find(group => group.id === sourceFilter));
      components.forEach(component => { component.groupId = sourceFilter; });
    }
    installLibraryImport(components, groups, t('导入自定义组件'));
  } else {
    const type = /\.svg$/i.test(file.name) ? 'svg' : 'html';
    sanitizeContent(content, type);
    openComponentDialog(type, null, file.name.replace(/\.[^.]+$/, ''));
    $('customCode').value = content;
    previewCustomComponent();
  }
}));
$('saveSelectionComponentBtn').addEventListener('click', () => {
  const item = selectedItem(); if (!item) return;
  finishGesture(); openComponentDialog(item.type, item.type === 'image' ? item.content : null, item.name);
  $('customWidth').value = item.width; $('customHeight').value = item.height;
  if (item.type !== 'image') $('customCode').value = item.content;
  $('componentForm').dataset.sourceId = item.id;
  const response = normalizeOrientationResponse(item.orientationResponse);
  $('customOrientationEnabled').checked = response.enabled;
  $('customPortraitAction').value = response.portrait; $('customLandscapeAction').value = response.landscape;
  updateOrientationFields('custom');
});
$('libFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (file.size > MAX_LIBRARY_BYTES) throw new Error(t('组件库文件不能超过 12 MB'));
  const sourceSession = projectSession;
  const raw = JSON.parse(await readFile(file));
  const incoming = validateLibrary(raw, sanitizeContent);
  const incomingGroups = validateGroups(raw.groups);
  if (sourceSession !== projectSession) throw new Error(t('工程已切换，请重新导入组件库'));
  installLibraryImport(incoming, incomingGroups, t('导入组件库'));
}));
function openComponentDialog(type, data = null, name = '') {
  customType = type; imageData = data;
  $('componentForm').reset(); $('componentError').textContent = '';
  delete $('componentForm').dataset.sourceId;
  updateOrientationFields('custom');
  $('componentPreviewSection').hidden = true;
  clearComponentPreview($('componentPreview'));
  $('previewComponentBtn').hidden = type === 'image';
  $('customName').value = name;
  fillGroupSelect($('customGroup'), libraryGroups.some(group => group.id === groupFilter) ? groupFilter : '');
  $('dialogTitle').textContent = type === 'image' ? t('导入图片组件') : t`新建 ${type.toUpperCase()} 组件`;
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
    if (!$(id).checkValidity()) throw new Error(t('默认宽度和高度请输入 1～2000 的整数'));
  }
  const raw = customType === 'image' ? imageData : $('customCode').value;
  if (!contentSizeValid(raw, customType)) throw new Error(t('组件标记不能超过 100000 字符，内嵌图片另计体积'));
  const source = project.items.find(item => item.id === $('componentForm').dataset.sourceId);
  return validateLibrary([{ id: uid(), groupId: $('customGroup').value, name: preview ? $('customName').value.trim() || t('未命名组件') : $('customName').value, type: customType, content: raw, defaultWidth: $('customWidth').value, defaultHeight: $('customHeight').value, ...(source ? { appearance: source.appearance, imageSlot: source.imageSlot, defaultRadius: source.radius, padding: source.padding, margin: source.margin } : {}), orientationResponse: readOrientationFields('custom') }], sanitizeContent)[0];
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
    $('componentError').textContent = t(error.message);
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
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(file.type)) throw new Error(t('请选择 PNG、JPEG、GIF、WebP 或 AVIF 图片'));
  if (file.size > MAX_IMAGE) throw new Error(t('图片不能超过 3 MB'));
  const data = await readFile(file, 'dataURL');
  const image = new Image(); image.src = data;
  try { await image.decode(); } catch { throw new Error(t('图片内容无效，无法读取')); }
  return data;
}
$('imgFileInput').addEventListener('change', safeAction(async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const sourceSession = projectSession;
  const data = await readImageFile(file);
  const image = new Image(); image.src = data;
  try { await image.decode(); } catch { throw new Error(t('图片内容无效，无法读取')); }
  if (sourceSession !== projectSession) throw new Error(t('工程已切换，请重新导入图片'));
  openComponentDialog('image', data, file.name.replace(/\.[^.]+$/, ''));
  $('customWidth').value = Math.min(image.naturalWidth, 320); $('customHeight').value = Math.max(1, Math.round(Math.min(image.naturalWidth, 320) * image.naturalHeight / image.naturalWidth));
}));
$('componentForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (library.length >= MAX_LIBRARY) throw new Error(t('组件库最多支持 200 个组件'));
    const component = readCustomComponent();
    groupFilter = component.groupId || '';
    library = validateLibrary([...library, component], sanitizeContent); commit(t`添加自定义组件：${component.name}`); setLibraryTab('custom'); $('componentDialog').close();
    assistant.saveVersion(t('保存自定义组件'));
    if (persistLibrary()) notify(t`「${component.name}」已添加并保存到组件库`);
  } catch (error) { $('componentError').textContent = t(error.message); }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
$('previewBtn').addEventListener('click', () => {
  finishGesture(); previewSession = { token: uid(), projectSession };
  $('previewFrame').srcdoc = exportHTML(project, { preview: true, editToken: previewSession.token }); $('previewDialog').showModal();
});
$('previewDialog').addEventListener('close', () => { previewSession = null; $('previewFrame').removeAttribute('srcdoc'); });
window.addEventListener('message', event => {
  const message = event.data;
  if (!previewSession || !$('previewDialog').open || previewSession.projectSession !== projectSession || event.source !== $('previewFrame').contentWindow || message?.type !== 'protolab-preview-edit' || message.token !== previewSession.token) return;
  const snapshot = withPages(project), page = snapshot.pages.find(page => page.id === message.pageId);
  const original = page?.items.find(item => item.id === message.itemId);
  if (!original) return;
  let item = original, error;
  try {
    if (message.kind === 'text') {
      const values = editableContent(original).texts.map(text => text.value);
      if (!Array.isArray(message.changes) || !message.changes.length || message.changes.some(change => !Number.isInteger(change.index) || change.index < 0 || change.index >= values.length || typeof change.value !== 'string')) throw new Error(t('文字修改无效'));
      for (const change of message.changes) values[change.index] = change.value;
      const content = updateTextContent(original, values);
      if (!contentSizeValid(content, original.type)) throw new Error(t('组件文字过长，请缩短内容'));
      item = { ...original, content };
    } else if (message.kind === 'resize') {
      const keys = ['x', 'y', 'width', 'height'];
      if (!message.geometry || keys.some(key => !Number.isFinite(message.geometry[key]))) throw new Error(t('组件尺寸无效'));
      item = normalizeItem({ ...original, ...Object.fromEntries(keys.map(key => [key, message.geometry[key]])) }, page.canvas, itemBounds(page));
    } else return;
    if (JSON.stringify(item) !== JSON.stringify(original)) {
      const items = page.items.map(value => value.id === item.id ? item : value);
      project = { ...snapshot, pages: snapshot.pages.map(value => value.id === page.id ? { ...value, items } : value), ...(page.id === snapshot.activePageId ? { items } : {}) };
      commit(message.kind === 'text' ? t('预览修改文字') : t('预览调整尺寸'));
    }
  } catch (failure) { error = failure.message; notify(error, true); }
  event.source.postMessage({ type: 'protolab-preview-result', token: previewSession.token, pageId: page.id, itemId: original.id, item,
    html: itemHTML(item, page.canvas), ...(error ? { error } : {}) }, '*');
});
$('exportHtmlBtn').addEventListener('click', () => { finishGesture(); download(exportHTML(project), 'prototype.html', 'text/html;charset=utf-8'); notify(t('原型已导出为 prototype.html')); });
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  const panel = $(button.dataset.panel === 'library' ? 'libraryPanel' : 'inspectorColumn');
  const shouldOpen = !panel.classList.contains('open');
  document.querySelectorAll('.sidebar,.inspector-column').forEach(value => value.classList.remove('open'));
  document.querySelectorAll('[data-panel]').forEach(value => value.setAttribute('aria-expanded', 'false'));
  if (shouldOpen) { panel.classList.add('open'); button.setAttribute('aria-expanded', 'true'); }
}));
document.addEventListener('keydown', safeAction(event => {
  if (event.defaultPrevented) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
  if (document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); return; }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); restore('redo'); return; }
  if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (event.key === 'Escape') { finishGesture(true); select(null); return; }
  if (['Delete', 'Backspace'].includes(event.key) && selectedItem()) { event.preventDefault(); removeSelected(); return; }
  const item = selectedItem();
  if (item && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); const distance = event.shiftKey ? 10 : 1;
    project = moveItems(project, selectionStarts(), event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0, event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0); commit(t('键盘移动组件'));
  }
}));
window.addEventListener('pagehide', () => { finishGesture(); if (saveTimer) persistProject(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) persistProject(); });
const mcpEditor = createMCPEditor({
  getState: () => ({ projectId: catalog.activeId, ...projectDetails(currentRecord()), project, library, libraryGroups }),
  getAssets: value => designAssets(currentRecord()?.design, value, library, libraryGroups),
  sanitize: sanitizeContent,
  isBusy: () => !!gesture || assistant.isBusy(),
  apply(value, label) {
    assistant.saveVersion(t('MCP 修改前'));
    project = withPages(value); selectedId = null; selectedIds.clear(); commit(label);
    assistant.saveVersion(label); persistProject(); notify(t('MCP 修改已应用，可撤销或回退版本'));
  },
  exportFile(format) {
    if (format === 'html') return { filename: 'prototype.html', mimeType: 'text/html', content: exportHTML(project) };
    return { filename: 'protolab-project.json', mimeType: 'application/json', content: projectFile(project, library, projectDetails(currentRecord()), libraryGroups) };
  },
});
const mcpConnection = initializeMCPConnection({ editor: mcpEditor, notify,
  getMetadata: () => ({ projectId: catalog.activeId, name: currentRecord().name, activePageId: project.activePageId }),
});
renderProjects(); renderLibrary(); renderCanvas(); renderHistory(); assistant.refreshVersions();
if (window.innerWidth < 900) requestAnimationFrame(fitCanvas);
if (startupWarnings.length) notify(startupWarnings.join('；'), true);
else if (project.items.length) { $('saveState').textContent = t('已恢复本地草稿'); $('statusMessage').textContent = t('已恢复上次设计 · 所有修改将自动保存'); }

initializeLanguage({
  refreshStatic: refreshStaticTranslations,
  onChange() {
    renderLibrary(); renderPages(); renderLayers(); renderHistory(); assistant.refreshLocale(); mcpConnection.refreshLocale();
    const canvas = project.canvas;
    $('presetLabel').textContent = `${t(PRESETS[canvas.preset]?.label || '自定义')} · ${canvas.width > canvas.height ? t('横屏') : t('竖屏')}`;
    // 只更新界面，不重填属性、对话或设置表单，保留尚未应用的输入。
    for (const id of ['customGroup', 'manageComponentGroup']) {
      const first = $(id).options[0]; if (first?.value === '') first.textContent = t('未分组');
    }
    const target = $('propClickTarget').options[0]; if (target?.value === '') target.textContent = t('请选择目标');
    if ($('engineeringDialog').open) renderEngineeringLinks();
  },
});
