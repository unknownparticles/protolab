export const CONTAINER_LAYOUTS = Object.freeze({ vertical: '纵向布局', horizontal: '横向布局', grid: '网格布局' });
export const CONTAINERS = Object.entries(CONTAINER_LAYOUTS).map(([mode, name]) => ({
  id: `container-${mode}`, name, type: 'html', content: '<div></div>',
  defaultWidth: 300, defaultHeight: mode === 'horizontal' ? 120 : 260,
  defaultRadius: 8, padding: '16px', container: { mode, gap: 12, columns: 2 },
}));
export function normalizeContainer(value) {
  if (!value || !Object.hasOwn(CONTAINER_LAYOUTS, value.mode)) throw new Error('容器布局格式不正确');
  const integer = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback;
  return { mode: value.mode, gap: integer(value.gap, 12, 0, 200), columns: integer(value.columns, 2, 1, 12) };
}
/** 子组件保留首选尺寸；缩小容器时按比例容纳，扩大后恢复，不累积缩放误差。 */
export function containerLayout(items, collapse = false) {
  const result = items.map(item => ({ ...item }));
  for (const parent of result.filter(item => item.container)) {
    const all = result.filter(item => item.parentId === parent.id);
    const children = all.filter(item => !collapse || item.visible !== false || item.collapseSpace === false);
    const tokens = String(parent.padding || '0').split(/\s+/).map(value => parseFloat(value) || 0);
    let [top, right = top, bottom = top, left = right] = tokens;
    left = Math.min(left, Math.max(0, parent.width - 1)); right = Math.min(right, Math.max(0, parent.width - left - 1));
    top = Math.min(top, Math.max(0, parent.height - 1)); bottom = Math.min(bottom, Math.max(0, parent.height - top - 1));
    const width = parent.width - left - right, height = parent.height - top - bottom;
    const { mode, gap, columns } = parent.container;
    const count = children.length;
    if (!count) continue;
    const cols = mode === 'grid' ? columns : mode === 'horizontal' ? count : 1;
    const rows = mode === 'grid' ? Math.ceil(count / cols) : mode === 'vertical' ? count : 1;
    const gx = Math.min(gap, Math.max(0, (width - Math.min(width, cols)) / Math.max(1, cols - 1)));
    const gy = Math.min(gap, Math.max(0, (height - Math.min(height, rows)) / Math.max(1, rows - 1)));
    const availableW = width - gx * (cols - 1), availableH = height - gy * (rows - 1);
    const total = children.reduce((sum, item) => sum + (mode === 'horizontal' ? item.layoutBasis?.width || item.width : item.layoutBasis?.height || item.height), 0);
    const scale = Math.min(1, (mode === 'horizontal' ? availableW : availableH) / total);
    let offset = 0;
    children.forEach((item, index) => {
      item.x = parent.x + left + (mode === 'grid' ? index % cols * (availableW / cols + gx) : mode === 'horizontal' ? offset : 0);
      item.y = parent.y + top + (mode === 'grid' ? Math.floor(index / cols) * (availableH / rows + gy) : mode === 'vertical' ? offset : 0);
      item.width = mode === 'grid' ? availableW / cols : mode === 'horizontal' ? (item.layoutBasis?.width || item.width) * scale : width;
      item.height = mode === 'grid' ? availableH / rows : mode === 'vertical' ? (item.layoutBasis?.height || item.height) * scale : height;
      offset += (mode === 'horizontal' ? item.width + gx : item.height + gy);
    });
  }
  return result;
}
export function validateContainerLinks(items) {
  const parents = new Map(items.filter(item => item.container).map(item => [item.id, item]));
  for (const item of items) if (item.parentId != null && (!parents.has(item.parentId) || item.container)) throw new Error('组件所属容器不存在或容器发生嵌套');
}
/** 容器与内部组件作为一个连续图层组，避免背景遮住内部内容。 */
export function containerOrder(items) {
  return items.filter(item => !item.parentId).flatMap(item => item.container ? [item, ...items.filter(child => child.parentId === item.id)] : [item]);
}
