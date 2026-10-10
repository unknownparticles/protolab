/** 显隐布局只投影原始坐标，重复切换不会累积偏移。方向隐藏不参与收起。 */
export function visibilityLayout(items) {
  const hidden = items.filter(item => item.visible === false && item.collapseSpace !== false);
  if (!hidden.length) return items;
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width;
  return items.map(item => {
    const spans = hidden.filter(value => value.id !== item.id && overlap(value, item) && value.y + value.height <= item.y)
      .map(value => [value.y, value.y + value.height]);
    if (!spans.length) return item;
    // 同一行仍有可见内容时保留它的空间，避免多列布局相互覆盖。
    const occupied = items.filter(value => value.id !== item.id && value.visible !== false && overlap(value, item) && value.y < item.y)
      .map(value => [value.y, Math.min(item.y, value.y + value.height)]);
    const points = [...new Set(spans.flat().concat(occupied.flat()))].sort((a, b) => a - b);
    let offset = 0;
    for (let i = 1; i < points.length; i++) {
      const middle = (points[i - 1] + points[i]) / 2;
      if (spans.some(([start, end]) => start <= middle && middle < end) && !occupied.some(([start, end]) => start <= middle && middle < end)) offset += points[i] - points[i - 1];
    }
    return offset ? { ...item, y: item.y - offset } : item;
  });
}

/** 将属性或对齐指定的显示坐标换回展开坐标。 */
export function expandedY(items, id, displayedY) {
  const original = items.find(item => item.id === id);
  let y = displayedY + original.y - visibilityLayout(items).find(item => item.id === id).y;
  for (let step = 0; step <= items.length; step++) {
    const values = items.map(item => item.id === id ? { ...item, y } : item);
    const projected = visibilityLayout(values).find(item => item.id === id);
    const next = displayedY + y - projected.y;
    if (next === y) return y;
    y = next;
  }
  return y;
}

export function visibilityBounds(bounds, items) {
  const hidden = items.filter(item => item.visible === false && item.collapseSpace !== false);
  if (!hidden.length) return bounds;
  return { ...bounds, maxItemHeight: bounds.height, height: bounds.height + hidden.reduce((sum, item) => sum + Math.max(0, Math.min(bounds.height, Number(item.height) || 0)), 0) };
}
