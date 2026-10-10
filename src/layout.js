/** 布局操作始终以画布像素计算，与缩放和设备外框无关。 */
import { placementBounds } from './safe-area.js';
export function selectionBounds(items) {
  if (!items.length) return null;
  const x = Math.min(...items.map(item => item.x));
  const y = Math.min(...items.map(item => item.y));
  return { x, y, width: Math.max(...items.map(item => item.x + item.width)) - x,
    height: Math.max(...items.map(item => item.y + item.height)) - y };
}
export function alignItems(project, ids, direction, reference = 'canvas') {
  if (!['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'center'].includes(direction)) throw new Error('不支持的对齐方式');
  const selected = project.items.filter(item => ids.has(item.id));
  if (!selected.length || reference === 'selection' && selected.length < 2) return project;
  const bounds = reference === 'selection' ? selectionBounds(selected) : placementBounds(project);
  return { ...project, items: project.items.map(item => {
    if (!ids.has(item.id)) return item;
    let { x, y } = item;
    if (direction === 'left') x = bounds.x;
    if (direction === 'right') x = bounds.x + bounds.width - item.width;
    if (direction === 'centerX' || direction === 'center') x = Math.round(bounds.x + (bounds.width - item.width) / 2);
    if (direction === 'top') y = bounds.y;
    if (direction === 'bottom') y = bounds.y + bounds.height - item.height;
    if (direction === 'centerY' || direction === 'center') y = Math.round(bounds.y + (bounds.height - item.height) / 2);
    return { ...item, x, y };
  }) };
}
/** 整组移动统一约束，触碰边界时保留组件相对位置。 */
export function moveItems(project, starts, dx, dy) {
  const selected = project.items.filter(item => starts.has(item.id)).map(item => ({ ...item, ...starts.get(item.id) }));
  const bounds = selectionBounds(selected);
  if (!bounds) return project;
  const available = placementBounds(project);
  dx = Math.round(Math.max(available.x - bounds.x, Math.min(available.x + available.width - bounds.x - bounds.width, dx)));
  dy = Math.round(Math.max(available.y - bounds.y, Math.min(available.y + available.height - bounds.y - bounds.height, dy)));
  return { ...project, items: project.items.map(item => starts.has(item.id) ? { ...item, x: starts.get(item.id).x + dx, y: starts.get(item.id).y + dy } : item) };
}
