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
export function normalizeItem(item, canvas) {
  const width = number(item.width, 100, 1, canvas.width);
  const height = number(item.height, 40, 1, canvas.height);
  return {
    ...item, name: String(item.name || '未命名').slice(0, 80), width, height,
    x: number(item.x, 0, 0, canvas.width - width),
    y: number(item.y, 0, 0, canvas.height - height),
    radius: number(item.radius, 8, 0, 50), padding: spacing(item.padding ?? '0'), margin: spacing(item.margin ?? '0'),
  };
}
export function resizeProject(project, width, height, preset = 'custom') {
  const canvas = { width: number(width, 375, 100, 2000), height: number(height, 667, 100, 2000), preset };
  return { ...project, canvas, items: project.items.map(item => normalizeItem(item, canvas)) };
}
export function createItem(component, canvas, x = 40, y = 40) {
  return normalizeItem({
    id: uid(), name: component.name, type: component.type,
    content: component.content, x, y, width: component.defaultWidth,
    height: component.defaultHeight, radius: 8, padding: '0', margin: '0',
  }, canvas);
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
      builtin: entry.builtin === true || entry.type === 'preset',
      defaultWidth: number(entry.defaultWidth, 120, 1, 2000), defaultHeight: number(entry.defaultHeight, 60, 1, 2000) };
  });
}
export function validateProject(raw, sanitize) {
  if (!raw || raw.version !== 1 || !raw.canvas || !Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) throw new Error('草稿格式不正确');
  const project = resizeProject({ version: 1, items: [] }, raw.canvas.width, raw.canvas.height, PRESETS[raw.canvas.preset] ? raw.canvas.preset : 'custom');
  const ids = new Set();
  project.items = raw.items.map(item => {
    if (!item || !['html', 'svg', 'image'].includes(item.type) || typeof item.content !== 'string' || item.content.length > (item.type === 'image' ? MAX_IMAGE * 1.4 : MAX_CODE)) throw new Error('草稿组件格式不正确');
    const id = typeof item.id === 'string' ? item.id : uid();
    if (ids.has(id)) throw new Error('草稿中存在重复标识');
    ids.add(id);
    return normalizeItem({ ...item, id, content: sanitize(item.content, item.type) }, project.canvas);
  });
  return project;
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
