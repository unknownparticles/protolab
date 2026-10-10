import { normalizeSafeArea, placementBounds } from './safe-area.js';

export const COLOR_ROLES = { primary: '主色', secondary: '辅助色', background: '页面背景', surface: '卡片背景', text: '正文', muted: '辅助文字', border: '边框' };
export const PALETTES = {
  blue: { name: '清爽蓝', colors: { primary: '#2563eb', secondary: '#0ea5e9', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', muted: '#64748b', border: '#e2e8f0' } },
  purple: { name: '商务紫', colors: { primary: '#7c3aed', secondary: '#a855f7', background: '#faf5ff', surface: '#ffffff', text: '#1e1b4b', muted: '#6b7280', border: '#e9d5ff' } },
  green: { name: '自然绿', colors: { primary: '#059669', secondary: '#0d9488', background: '#f0fdf4', surface: '#ffffff', text: '#14532d', muted: '#6b7280', border: '#d1fae5' } },
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function normalizeDesign(raw = {}) {
  if (!object(raw)) throw new Error('工程关联设置格式不正确');
  let palette = null;
  if (raw.palette != null) {
    if (!object(raw.palette) || typeof raw.palette.name !== 'string' || !raw.palette.name.trim() || raw.palette.name.trim().length > 40 || !object(raw.palette.colors)) throw new Error('配色名称和颜色格式不正确');
    const colors = {};
    for (const role of Object.keys(COLOR_ROLES)) {
      const color = raw.palette.colors[role];
      if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new Error(`${COLOR_ROLES[role]}须为六位十六进制颜色`);
      colors[role] = color.toLowerCase();
    }
    palette = { name: raw.palette.name.trim(), colors };
  }
  const library = raw.library ?? { scope: 'all', groupIds: [] };
  if (!object(library) || !['all', 'custom', 'groups', 'none'].includes(library.scope) || !Array.isArray(library.groupIds ?? []) || (library.groupIds || []).length > 200 || (library.groupIds || []).some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Error('请选择有效的组件库关联范围');
  const safeArea = raw.safeArea ?? { mode: 'current' };
  if (!object(safeArea) || !['current', 'custom', 'none'].includes(safeArea.mode)) throw new Error('安全区关联方式不正确');
  const area = { mode: safeArea.mode };
  if (safeArea.mode === 'custom') {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      if (!Number.isInteger(safeArea[edge]) || safeArea[edge] < 0 || safeArea[edge] > 2000) throw new Error('安全区留白须为零至两千的整数');
      area[edge] = safeArea[edge];
    }
    area.enabled = true;
  }
  return { palette, library: { scope: library.scope, groupIds: [...new Set(library.groupIds || [])] }, safeArea: area };
}
export function linkedComponents(design, library, groups = []) {
  const { scope, groupIds } = normalizeDesign(design).library;
  const validGroups = new Set(groups.map(group => group.id));
  return library.filter(item => scope === 'all' || scope === 'custom' && !item.builtin || scope === 'groups' && !item.builtin && validGroups.has(item.groupId) && groupIds.includes(item.groupId));
}
export function libraryManifest(library, groups = []) {
  return { version: 1, components: library.map(item => ({ id: item.id, name: item.name, type: item.type,
    width: item.defaultWidth, height: item.defaultHeight, group: groups.find(group => group.id === item.groupId)?.name || (item.builtin ? '内置' : '未分组'),
    ...(item.orientationResponse?.enabled ? { orientationResponse: { ...item.orientationResponse } } : {}),
    ...(item.imageSlot ? { imageSlot: true } : {}) })) };
}
export function designAssets(raw, project, library, groups = []) {
  const design = normalizeDesign(raw);
  const components = linkedComponents(design, library, groups);
  const area = design.safeArea.mode === 'current' ? project.safeArea : design.safeArea.mode === 'none' ? { enabled: false } : design.safeArea;
  const safeArea = normalizeSafeArea(area, project.canvas, project.frame);
  return { library: components, context: { palette: design.palette, library: libraryManifest(components, groups),
    safeArea: { ...safeArea, mode: design.safeArea.mode, bounds: placementBounds({ ...project, safeArea }) },
    device: { width: project.canvas.width, height: project.canvas.height, preset: project.canvas.preset } } };
}
