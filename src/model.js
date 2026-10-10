import { normalizeFrame } from './frames.js';
import { normalizeSafeArea, placementBounds } from './safe-area.js';
import { normalizeOrientationResponse } from './orientation.js';
import { MAX_PAGES, normalizeInteraction, syncPages, pageBoard, validatePageLinks } from './pages.js';
/** 与 DOM 无关的画布模型；坐标始终使用实际画布像素。 */
export const PRESETS = Object.freeze({
  phone: { width: 375, height: 667, label: '手机' },
  tablet: { width: 768, height: 1024, label: '平板' },
  pc: { width: 1280, height: 800, label: 'PC' },
});
export const MAX_ITEMS = 200;
export const MAX_LIBRARY = 200;
export const MAX_LIBRARY_BYTES = 12 * 1024 * 1024;
export const MAX_CODE = 100_000;
export const MAX_IMAGE = 3 * 1024 * 1024;
export const uid = () => globalThis.crypto.randomUUID();
export const clone = value => structuredClone(value);
export function number(value, fallback, min, max) {
  const parsed = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}
export function spacing(value = '0') {
  const tokens = String(value).trim().split(/\s+/);
  if (tokens.length < 1 || tokens.length > 4 || !tokens.every(token => /^(?:0|\d+(?:\.\d+)?px)$/.test(token) && parseFloat(token) <= 200)) {
    throw new Error('边距请输入 1～4 个非负像素值，例如 8px 12px（每项不超过 200px）');
  }
  return tokens.join(' ');
}
export function normalizeItem(item, canvas, bounds = { x: 0, y: 0, ...canvas }) {
  const interaction = normalizeInteraction(item.interaction);
  const width = number(item.width, 100, 1, bounds.width);
  const height = number(item.height, 40, 1, bounds.height);
  const result = {
    ...item, name: String(item.name || '未命名').slice(0, 80), width, height,
    x: number(item.x, bounds.x, bounds.x, bounds.x + bounds.width - width),
    y: number(item.y, bounds.y, bounds.y, bounds.y + bounds.height - height),
    radius: number(item.radius, 8, 0, 50), padding: spacing(item.padding ?? '0'), margin: spacing(item.margin ?? '0'),
    orientationResponse: normalizeOrientationResponse(item.orientationResponse),
  };
  if (interaction) result.interaction = interaction;
  else delete result.interaction;
  return result;
}
export function resizeProject(project, width, height, preset = 'custom') {
  const canvas = { ...project.canvas, width: number(width, 375, 100, 2000), height: number(height, 667, 100, 2000), preset };
  delete canvas.layoutSize;
  return constrainProject({ ...project, canvas, ...(project.frame ? { frame: normalizeFrame(project.frame, preset) } : {}) });
}
/** 方向切换扩大可保存的设计范围，越界内容由屏幕裁切，避免逐个挪动。 */
export function rotateProject(project) {
  const { canvas } = project;
  const extent = Math.max(canvas.width, canvas.height);
  return constrainProject({ ...project, canvas: { ...canvas, width: canvas.height, height: canvas.width,
    layoutSize: { width: extent, height: extent } } });
}
export function itemBounds(project) {
  const size = project.canvas.layoutSize;
  return size ? { x: 0, y: 0, ...size } : placementBounds(project);
}
export function constrainProject(project, fitToCanvas = false) {
  const next = { ...project, safeArea: normalizeSafeArea(project.safeArea, project.canvas, project.frame) };
  if (fitToCanvas) { next.canvas = { ...next.canvas }; delete next.canvas.layoutSize; }
  const bounds = itemBounds(next);
  return syncPages({ ...next, items: next.items.map(item => normalizeItem(item, next.canvas, bounds)) });
}
export function createItem(component, canvas, x = 40, y = 40, bounds) {
  return normalizeItem({
    id: uid(), name: component.name, type: component.type, imported: false,
    content: component.content, x, y, width: component.defaultWidth,
    height: component.defaultHeight, radius: component.type === 'svg' ? 0 : 8, padding: '0', margin: '0',
    orientationResponse: component.orientationResponse,
  }, canvas, bounds);
}
export function validateLibrary(raw, sanitize) {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > MAX_LIBRARY_BYTES) throw new Error('组件库总大小不能超过 12 MB');
  const values = Array.isArray(raw) ? raw : raw?.version === 1 && raw.components;
  if (!Array.isArray(values) || values.length > MAX_LIBRARY) throw new Error('组件库须为 JSON 数组或版本 1 的组件库，最多 200 个组件');
  const seen = new Set();
  return values.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`第 ${index + 1} 个组件缺少名称`);
    const type = entry.type === 'image' ? 'image' : entry.svg || entry.type === 'svg' ? 'svg' : 'html';
    const content = entry.svg ?? entry.html ?? entry.content;
    if (typeof content !== 'string' || !content.trim() || content.length > (type === 'image' ? MAX_IMAGE * 1.4 : MAX_CODE)) throw new Error(`组件「${entry.name}」的内容为空或过大`);
    const safe = sanitize(content, type);
    if (!safe.trim()) throw new Error(`组件「${entry.name}」没有可用内容`);
    const id = typeof entry.id === 'string' && entry.id.length <= 100 ? entry.id : uid();
    if (seen.has(id)) throw new Error('组件库中存在重复标识');
    seen.add(id);
    return { id, name: entry.name.trim().slice(0, 80), type, content: safe,
      builtin: entry.builtin === true || entry.type === 'preset', category: type === 'svg' ? 'vector' : 'basic',
      orientationResponse: normalizeOrientationResponse(entry.orientationResponse),
      defaultWidth: number(entry.defaultWidth, 120, 1, 2000), defaultHeight: number(entry.defaultHeight, 60, 1, 2000) };
  });
}
function validateBoard(raw, sanitize) {
  if (!raw || raw.version !== 1 || !raw.canvas || !Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) throw new Error('草稿格式不正确');
  const project = resizeProject({ version: 1, items: [] }, raw.canvas.width, raw.canvas.height, PRESETS[raw.canvas.preset] ? raw.canvas.preset : 'custom');
  if (raw.canvas.layoutSize != null) {
    const extent = Math.max(project.canvas.width, project.canvas.height);
    if (raw.canvas.layoutSize.width !== extent || raw.canvas.layoutSize.height !== extent) throw new Error('方向切换的设计范围格式不正确');
    project.canvas.layoutSize = { width: extent, height: extent };
  }
  if (typeof raw.canvas.background === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(raw.canvas.background)) project.canvas.background = raw.canvas.background;
  project.frame = normalizeFrame(raw.frame, project.canvas.preset, sanitize);
  project.safeArea = normalizeSafeArea(raw.safeArea, project.canvas, project.frame);
  const ids = new Set();
  project.items = raw.items.map(item => {
    if (!item || !['html', 'svg', 'image'].includes(item.type) || typeof item.content !== 'string' || item.content.length > (item.type === 'image' ? MAX_IMAGE * 1.4 : MAX_CODE)) throw new Error('草稿组件格式不正确');
    const id = typeof item.id === 'string' ? item.id : uid();
    if (ids.has(id)) throw new Error('草稿中存在重复标识');
    ids.add(id);
    return normalizeItem({ ...item, id, imported: item.imported === true, content: sanitize(item.content, item.type) }, project.canvas, itemBounds(project));
  });
  return project;
}
export function validateProject(raw, sanitize) {
  const project = validateBoard(raw, sanitize);
  if (raw.pages != null) {
    if (!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > MAX_PAGES) throw new Error('页面与弹窗合计须为 1～30 个');
    const ids = new Set();
    project.pages = raw.pages.map(page => {
      if (!page || typeof page.id !== 'string' || !page.id || page.id.length > 100 || ids.has(page.id) || !['page', 'popup'].includes(page.kind) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 40 || page.pages != null) throw new Error('页面格式不正确或标识重复');
      ids.add(page.id);
      const board = validateBoard({ ...page, version: 1 }, sanitize);
      return { id: page.id, name: page.name.trim(), kind: page.kind, ...pageBoard(board) };
    });
    if (!ids.has(raw.activePageId) || !project.pages.some(page => page.id === raw.startPageId && page.kind === 'page')) throw new Error('当前页面或首页不存在');
    project.activePageId = raw.activePageId;
    project.startPageId = raw.startPageId;
  }
  const result = syncPages(project);
  validatePageLinks(result);
  return result;
}
export function createHistory(initial, limit = 60) {
  let values = [clone(initial)];
  let cursor = 0;
  return {
    push(value) {
      if (JSON.stringify(values[cursor]) === JSON.stringify(value)) return;
      values = values.slice(0, cursor + 1);
      values.push(clone(value));
      if (values.length > limit) values.shift();
      cursor = values.length - 1;
    },
    undo() { if (cursor > 0) cursor--; return clone(values[cursor]); },
    redo() { if (cursor < values.length - 1) cursor++; return clone(values[cursor]); },
    get canUndo() { return cursor > 0; }, get canRedo() { return cursor < values.length - 1; },
  };
}
export function clientToCanvas(clientX, clientY, rect, zoom) {
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}
