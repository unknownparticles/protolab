import { clone, uid, PRESETS, validateProject, validateLibrary } from './model.js';
import { normalizeFrame } from './frames.js';
import { withPages } from './pages.js';
import { createVersions, validateWorkspace } from './versions.js';

export const PROJECTS_KEY = 'protolab.projects.v1';
export const MAX_PROJECTS = 50;
export function projectDetails(raw = {}) {
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.trim().length > 40) throw new Error('工程名称请输入 1～40 个字符');
  if (typeof (raw.rules ?? '') !== 'string' || (raw.rules || '').length > 10000) throw new Error('工程规范不能超过 10000 个字符');
  return { name: raw.name.trim(), rules: (raw.rules || '').trim() };
}
export function emptyProject(preset = 'phone') {
  if (!PRESETS[preset]) throw new Error('请选择有效的设备尺寸');
  return withPages({ version: 1, canvas: { ...PRESETS[preset], preset }, frame: normalizeFrame({ camera: preset === 'phone' ? 'island' : 'none' }, preset),
    safeArea: { enabled: false, top: 0, right: 0, bottom: 0, left: 0 }, items: [] });
}
export function projectRecord(details, project, library, workspace) {
  return { id: uid(), ...projectDetails(details), project: clone(project), library: clone(library),
    workspace: workspace || { version: 1, versions: createVersions(project).serialize(), messages: [], pending: null } };
}
export function validateProjects(raw, sanitize) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > MAX_PROJECTS) throw new Error('工程列表格式不正确');
  const ids = new Set();
  const entries = raw.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 || ids.has(entry.id)) throw new Error('工程标识为空或重复');
    ids.add(entry.id);
    const project = validateProject(entry.project, sanitize);
    return { id: entry.id, ...projectDetails(entry), project: withPages(project), library: validateLibrary(entry.library, sanitize),
      workspace: validateWorkspace(entry.workspace, value => validateProject(value, sanitize)) };
  });
  if (!ids.has(raw.activeId)) throw new Error('当前工程不存在');
  return { version: 1, activeId: raw.activeId, entries };
}
export function saveActiveProject(catalog, snapshot) {
  return { ...catalog, entries: catalog.entries.map(entry => entry.id === catalog.activeId ? { ...entry, ...clone(snapshot) } : entry) };
}
export function activateProject(catalog, id) {
  if (!catalog.entries.some(entry => entry.id === id)) throw new Error('工程不存在');
  return { ...catalog, activeId: id };
}
export function appendProject(catalog, entry) {
  if (catalog.entries.length >= MAX_PROJECTS) throw new Error('最多保存 50 个工程，请导出备份');
  if (catalog.entries.some(value => value.id === entry.id)) throw new Error('工程标识重复');
  return { ...catalog, activeId: entry.id, entries: [...catalog.entries, clone(entry)] };
}
