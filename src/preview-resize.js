/** 指针位移转为组件局部方向，反向边保持固定，尺寸限定在页面设计范围。 */
export function resizePreviewItem(start, direction, dx, dy, bounds, angle = 0) {
  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  const west = direction.includes('w'), north = direction.includes('n');
  const horizontal = west || direction.includes('e'), vertical = north || direction.includes('s');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  const maxWidth = angle ? bounds.width : west ? start.x + start.width - bounds.x : bounds.x + bounds.width - start.x;
  const maxHeight = angle ? bounds.height : north ? start.y + start.height - bounds.y : bounds.y + bounds.height - start.y;
  const width = horizontal ? clamp(start.width + localX * (west ? -1 : 1), 1, maxWidth) : start.width;
  const height = vertical ? clamp(start.height + localY * (north ? -1 : 1), 1, maxHeight) : start.height;
  const shiftX = (width - start.width) * (west ? -1 : 1) / 2;
  const shiftY = (height - start.height) * (north ? -1 : 1) / 2;
  return { x: clamp(start.x + start.width / 2 + shiftX * cos - shiftY * sin - width / 2, bounds.x, bounds.x + bounds.width - width),
    y: clamp(start.y + start.height / 2 + shiftX * sin + shiftY * cos - height / 2, bounds.y, bounds.y + bounds.height - height), width, height };
}
