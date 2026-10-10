import { moveItems, selectionBounds } from './layout.js';
import { placementBounds } from './safe-area.js';
import { orientationPresentation } from './orientation.js';
import { visibilityLayout, expandedY } from './visibility.js';

const anchors = (bounds, axis) => axis === 'x' ? [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width] : [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
/** 吸附距离以屏幕像素计，多选使用整体边界，最后仍受安全区约束。 */
export function snapItems(project, starts, dx, dy, zoom = 1, enabled = true) {
  let moved = moveItems(project, starts, dx, dy);
  const bounds = selectionBounds(visibilityLayout(moved.items).filter(item => starts.has(item.id)));
  if (!enabled || !bounds) return { project: moved, guides: [] };
  const available = placementBounds(project);
  const others = visibilityLayout(project.items).filter(item => !starts.has(item.id) && !orientationPresentation(item, project.canvas).hidden);
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
  const first = moved.items.find(item => starts.has(item.id));
  const shown = visibilityLayout(moved.items).find(item => item.id === first.id);
  moved = moveItems(project, starts, first.x - starts.get(first.id).x + corrections.x,
    expandedY(moved.items, first.id, shown.y + corrections.y) - starts.get(first.id).y);
  const result = selectionBounds(visibilityLayout(moved.items).filter(item => starts.has(item.id)));
  return { project: moved, guides: guides.filter(guide => Math.abs(anchors(result, guide.axis)[guide.index] - guide.position) <= .5) };
}
