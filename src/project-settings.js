import { t } from './i18n.js';
import { COMPONENTS } from './presets.js';
import { COLOR_ROLES, PALETTES, normalizeDesign, linkedComponents, libraryManifest } from './project-design.js';
import { download } from './storage.js';

const $ = id => document.getElementById(id);

/** 工程设置表单与关联素材展示，保存和工程切换仍由入口负责。 */
export function initializeProjectSettings({ getRecord, getLibrary, getGroups, notify }) {
  function openProjectDetails(create) {
    $('engineeringForm').reset(); $('engineeringError').textContent = '';
    $('engineeringTitle').textContent = create ? t('新建工程') : t('工程设置');
    $('engineeringForm').dataset.create = String(create);
    $('engineeringName').value = create ? '' : getRecord().name;
    $('engineeringRules').value = create ? '' : getRecord().rules;
    fillEngineeringDesign(create ? normalizeDesign() : normalizeDesign(getRecord().design));
    $('engineeringPresetField').hidden = !create;
    $('engineeringSubmitBtn').textContent = create ? t('创建并切换') : t('保存设置');
    $('engineeringDialog').showModal(); $('engineeringName').focus();
  }
  function engineeringLibrary() {
    return $('engineeringForm').dataset.create === 'true' ? COMPONENTS : getLibrary();
  }
  function engineeringGroups() {
    return $('engineeringForm').dataset.create === 'true' ? [] : getGroups();
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
  return { openProjectDetails, readEngineeringDesign, renderEngineeringLinks };
}
