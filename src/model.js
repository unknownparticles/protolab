import { normalizeFrame } from './frames.js';
import { normalizeAppearance } from './appearance.js';
import { normalizeSafeArea, placementBounds } from './safe-area.js';
import { normalizeOrientationResponse } from './orientation.js';
import { visibilityBounds } from './visibility.js';
import { normalizeContainer, containerLayout, containerOrder, validateContainerLinks } from './containers.js';
import { MAX_PAGES, PAGE_KINDS, normalizeInteraction, syncPages, pageBoard, validatePageLinks } from './pages.js';
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
/** 内嵌图片另计体积，避免正常上传的图片触发标记代码长度限制。 */
export function contentSizeValid(content, type) {
  if (typeof content !== 'string') return false;
  if (type === 'image') return content.length <= MAX_IMAGE * 1.4;
  if (content.length > MAX_LIBRARY_BYTES) return false;
  return content.replace(/data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+/g, '').length <= MAX_CODE;
}
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
  if (item.visible != null && typeof item.visible !== 'boolean') throw new Error('元素显示状态须为布尔值');
  if (item.collapseSpace != null && typeof item.collapseSpace !== 'boolean') throw new Error('隐藏布局设置须为布尔值');
  const interaction = normalizeInteraction(item.interaction);
  const width = number(item.width, 100, 1, bounds.width);
  const height = number(item.height, 40, 1, bounds.maxItemHeight ?? bounds.height);
  const result = {
    ...item, name: String(item.name || '未命名').slice(0, 80), width, height,
    x: number(item.x, bounds.x, bounds.x, bounds.x + bounds.width - width),
    y: number(item.y, bounds.y, bounds.y, bounds.y + bounds.height - height),
    radius: number(item.radius, 8, 0, 50), padding: spacing(item.padding ?? '0'), margin: spacing(item.margin ?? '0'),
    orientationResponse: normalizeOrientationResponse(item.orientationResponse),
  };
  if (interaction) result.interaction = interaction;
  else delete result.interaction;
  if (item.appearance != null) result.appearance = normalizeAppearance(item.appearance);
  if (item.container != null) result.container = normalizeContainer(item.container);
  if (item.type === 'html' && !item.container) {
    result.textBasis = {
      width: number(item.textBasis?.width ?? item.width, width, 1, 2000),
      height: number(item.textBasis?.height ?? item.height, height, 1, 2000),
    };
  } else delete result.textBasis;
  if (item.layoutBasis != null) result.layoutBasis = { width: number(item.layoutBasis.width, width, 1, 2000), height: number(item.layoutBasis.height, height, 1, 2000) };
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
  return visibilityBounds(size ? { x: 0, y: 0, ...size } : placementBounds(project), project.items);
}
export function constrainProject(project, fitToCanvas = false) {
  const next = { ...project, safeArea: normalizeSafeArea(project.safeArea, project.canvas, project.frame) };
  if (fitToCanvas) { next.canvas = { ...next.canvas }; delete next.canvas.layoutSize; }
  const bounds = itemBounds(next);
  const items = next.items.map(item => normalizeItem(item, next.canvas, bounds));
  validateContainerLinks(items);
  return syncPages({ ...next, items: containerOrder(containerLayout(items)) });
}
export function createItem(component, canvas, x = 40, y = 40, bounds) {
  return normalizeItem({
    id: uid(), name: component.name, type: component.type, imported: false,
    content: component.content, x, y, width: component.defaultWidth,
    height: component.defaultHeight, radius: component.defaultRadius ?? (component.type === 'svg' ? 0 : 8), padding: component.padding ?? '0', margin: component.margin ?? '0',
    orientationResponse: component.orientationResponse,
    ...(component.container ? { container: component.container } : {}),
    ...(component.imageSlot ? { imageSlot: true } : {}),
    ...(component.appearance ? { appearance: component.appearance } : {}),
    ...(component.textBasis ? { textBasis: component.textBasis } : {}),
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
    if (!contentSizeValid(content, type) || !content.trim()) throw new Error(`组件「${entry.name}」的内容为空或过大`);
    const safe = sanitize(content, type);
    if (!safe.trim()) throw new Error(`组件「${entry.name}」没有可用内容`);
    const id = typeof entry.id === 'string' && entry.id.length <= 100 ? entry.id : uid();
    if (seen.has(id)) throw new Error('组件库中存在重复标识');
    seen.add(id);
    return { id, name: entry.name.trim().slice(0, 80), type, content: safe,
      groupId: typeof entry.groupId === 'string' && entry.groupId.length <= 100 ? entry.groupId : '',
      ...(entry.defaultRadius != null ? { defaultRadius: number(entry.defaultRadius, 8, 0, 50) } : {}),
      ...(entry.padding != null ? { padding: spacing(entry.padding) } : {}),
      ...(entry.margin != null ? { margin: spacing(entry.margin) } : {}),
      builtin: entry.builtin === true || entry.type === 'preset', category: type === 'svg' ? 'vector' : 'basic',
      orientationResponse: normalizeOrientationResponse(entry.orientationResponse),
      ...(entry.imageSlot === true ? { imageSlot: true } : {}),
      ...(entry.appearance != null ? { appearance: normalizeAppearance(entry.appearance) } : {}),
      ...(type === 'html' && entry.textBasis != null ? { textBasis: {
        width: number(entry.textBasis.width, number(entry.defaultWidth, 120, 1, 2000), 1, 2000),
        height: number(entry.textBasis.height, number(entry.defaultHeight, 60, 1, 2000), 1, 2000),
      } } : {}),
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
    if (!item || !['html', 'svg', 'image'].includes(item.type) || !contentSizeValid(item.content, item.type)) throw new Error('草稿组件格式不正确');
    const id = typeof item.id === 'string' ? item.id : uid();
    if (ids.has(id)) throw new Error('草稿中存在重复标识');
    ids.add(id);
    return normalizeItem({ ...item, id, imported: item.imported === true, content: sanitize(item.content, item.type) }, project.canvas, itemBounds({ ...project, items: raw.items.filter(value => value && Number.isFinite(value.height)) }));
  });
  validateContainerLinks(project.items);
  project.items = containerOrder(containerLayout(project.items));
  return project;
}
export function validateProject(raw, sanitize) {
  const project = validateBoard(raw, sanitize);
  if (raw.pages != null) {
    if (!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length > MAX_PAGES) throw new Error('页面与弹窗合计须为 1～30 个');
    const ids = new Set();
    project.pages = raw.pages.map(page => {
      if (!page || typeof page.id !== 'string' || !page.id || page.id.length > 100 || ids.has(page.id) || !Object.hasOwn(PAGE_KINDS, page.kind) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 40 || page.pages != null) throw new Error('页面格式不正确或标识重复');
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
export function createHistory(initial, limit = Infinity) {
  const entry = (value, label) => ({ value: clone(value), label, createdAt: new Date().toISOString() });
  let entries = [entry(initial, '初始状态')];
  let cursor = 0;
  return {
    push(value, label = '修改设计') {
      if (JSON.stringify(entries[cursor].value) === JSON.stringify(value)) return;
      entries = entries.slice(0, cursor + 1);
      entries.push(entry(value, label));
      if (entries.length > limit) entries.shift();
      cursor = entries.length - 1;
    },
    checkout(index) {
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error('历史记录不存在');
      cursor = index; return clone(entries[cursor].value);
    },
    undo() { if (cursor > 0) cursor--; return clone(entries[cursor].value); },
    redo() { if (cursor < entries.length - 1) cursor++; return clone(entries[cursor].value); },
    get entries() { return clone(entries); }, get cursor() { return cursor; },
    get canUndo() { return cursor > 0; }, get canRedo() { return cursor < entries.length - 1; },
  };
}
export function clientToCanvas(clientX, clientY, rect, zoom) {
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}
