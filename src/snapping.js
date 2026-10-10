import { moveItems, selectionBounds } from './layout.js';
import { placementBounds } from './safe-area.js';

const anchors = (bounds, axis) => axis === 'x' ? [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width] : [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
/** 吸附距离以屏幕像素计，多选使用整体边界，最后仍受安全区约束。 */
export function snapItems(project, starts, dx, dy, zoom = 1, enabled = true) {
  let moved = moveItems(project, starts, dx, dy);
  const bounds = selectionBounds(moved.items.filter(item => starts.has(item.id)));
  if (!enabled || !bounds) return { project: moved, guides: [] };
  const available = placementBounds(project);
  const others = project.items.filter(item => !starts.has(item.id));
  const guides = [];
  const corrections = { x: 0, y: 0 };
  for (const axis of ['x', 'y']) {
    const source = anchors(bounds, axis);
    const limits = anchors(available, axis);
    const targets = others.flatMap(item => anchors(item, axis));
    let closest;
    for (let index = 0; index < source.length; index++) {
      for (const target of [limits[index], ...targets]) {
        const delta = Math.round(target - source[index]);
        if (Math.abs(target - source[index]) <= 6 / zoom && (!closest || Math.abs(delta) < Math.abs(closest.delta))) closest = { axis, position: target, index, delta };
      }
    }
    if (closest) { corrections[axis] = closest.delta; guides.push(closest); }
  }
  const startBounds = selectionBounds(project.items.filter(item => starts.has(item.id)).map(item => ({ ...item, ...starts.get(item.id) })));
  moved = moveItems(project, starts, bounds.x - startBounds.x + corrections.x, bounds.y - startBounds.y + corrections.y);
  const result = selectionBounds(moved.items.filter(item => starts.has(item.id)));
  return { project: moved, guides: guides.filter(guide => Math.abs(anchors(result, guide.axis)[guide.index] - guide.position) <= .5) };
}
