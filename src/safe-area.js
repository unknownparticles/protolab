import { systemBarInsets } from './frames.js';

const pixels = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(2000, Math.round(Number(value)))) : 0;
function fitInsets(first, second, length) {
  if (first + second < length) return [first, second];
  const start = Math.floor(first / (first + second) * (length - 1));
  return [start, length - 1 - start];
}
export function normalizeSafeArea(raw, canvas, frame) {
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new Error('安全区设置格式不正确');
  const bars = systemBarInsets(frame, canvas);
  const [left, right] = fitInsets(pixels(raw?.left), pixels(raw?.right), canvas.width);
  const [top, bottom] = fitInsets(pixels(raw?.top), pixels(raw?.bottom), Math.max(1, canvas.height - bars.top - bars.bottom));
  return { enabled: raw?.enabled === true, top, right, bottom, left };
}
/** 留白从系统栏内侧计算；旧草稿默认关闭限制。 */
export function placementBounds(project) {
  const { canvas, frame } = project;
  const area = normalizeSafeArea(project.safeArea, canvas, frame);
  if (!area.enabled) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const bars = systemBarInsets(frame, canvas);
  return { x: area.left, y: bars.top + area.top,
    width: canvas.width - area.left - area.right,
    height: canvas.height - bars.top - bars.bottom - area.top - area.bottom };
}
