/** 固定本轮优化范围；选中容器时包括其内部组件。 */
export function selectionScope(project, selectedIds) {
  const selected = new Set(selectedIds);
  const items = project.items.filter(item => selected.has(item.id) || selected.has(item.parentId));
  if (!items.length) throw new Error('请先框选或选中要优化的组件');
  const x = Math.min(...items.map(item => item.x)), y = Math.min(...items.map(item => item.y));
  return { pageId: project.activePageId || null, itemIds: items.map(item => item.id),
    bounds: { x, y, width: Math.max(...items.map(item => item.x + item.width)) - x,
      height: Math.max(...items.map(item => item.y + item.height)) - y } };
}

/** 布局、删除关联清理和规范化也不能间接改动范围外的组件。 */
export function validateSelectionResult(base, result, scope) {
  const ids = new Set(scope.itemIds);
  const outside = project => project.items.filter(item => !ids.has(item.id) && base.items.some(value => value.id === item.id));
  const settings = project => ({ ...project, items: [], ...(project.pages ? {
    pages: project.pages.map(page => page.id === scope.pageId ? { ...page, items: [] } : page),
  } : {}) });
  if (JSON.stringify(outside(base)) !== JSON.stringify(outside(result)) || JSON.stringify(settings(base)) !== JSON.stringify(settings(result))) {
    throw new Error('AI 修改影响了未选组件或页面设置，请重新生成；调整容器布局时请选中整个容器');
  }
  const b = scope.bounds;
  for (const item of result.items.filter(item => !base.items.some(value => value.id === item.id))) {
    if (item.x < b.x || item.y < b.y || item.x + item.width > b.x + b.width || item.y + item.height > b.y + b.height) {
      throw new Error('AI 新增组件超出了所选区域，请重新生成');
    }
  }
}

/** 框选工具使用屏幕坐标命中组件，自动适配缩放、滚动与方向旋转。 */
export function attachMarquee(viewport, canvas, { isEnabled, beforeSelect, getIds, setIds, onExit }) {
  const doc = viewport.ownerDocument, win = doc.defaultView;
  const overlay = doc.createElement('div');
  overlay.className = 'canvas-marquee'; overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true');
  canvas.append(overlay);
  let gesture = null, space = false, suppressClick = false;
  function finish(cancel = false) {
    if (!gesture) return;
    const old = gesture; gesture = null; overlay.hidden = true;
    if (cancel) setIds(old.selected);
    suppressClick = true;
    if (viewport.hasPointerCapture(old.id)) viewport.releasePointerCapture(old.id);
  }
  function update(event) {
    const g = gesture;
    const left = Math.min(g.x, event.clientX), top = Math.min(g.y, event.clientY);
    const right = Math.max(g.x, event.clientX), bottom = Math.max(g.y, event.clientY);
    const rect = canvas.getBoundingClientRect(), scale = rect.width / canvas.offsetWidth;
    const x = Math.max(rect.left, left), y = Math.max(rect.top, top);
    const width = Math.max(0, Math.min(rect.right, right) - x), height = Math.max(0, Math.min(rect.bottom, bottom) - y);
    Object.assign(overlay.style, { left: `${(x - rect.left) / scale}px`, top: `${(y - rect.top) / scale}px`, width: `${width / scale}px`, height: `${height / scale}px` });
    overlay.hidden = width === 0 || height === 0;
    const ids = new Set(g.additive ? g.selected : []);
    if (Math.hypot(event.clientX - g.x, event.clientY - g.y) >= 4 && width && height) {
      for (const node of canvas.querySelectorAll('.editor-item:not([hidden])')) {
        const b = node.getBoundingClientRect();
        if (b.left < x + width && b.right > x && b.top < y + height && b.bottom > y) ids.add(node.dataset.itemId);
      }
    }
    setIds([...ids]);
  }
  viewport.addEventListener('pointerdown', event => {
    if (!isEnabled() || space || gesture || event.button !== 0 || event.target.closest('input,textarea,select,[contenteditable],button,a')) return;
    const rect = viewport.getBoundingClientRect();
    if (event.clientX >= rect.left + viewport.clientWidth || event.clientY >= rect.top + viewport.clientHeight) return;
    event.preventDefault(); event.stopImmediatePropagation(); beforeSelect();
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, selected: [...getIds()], additive: event.shiftKey };
    viewport.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  }, true);
  viewport.addEventListener('pointermove', event => {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault(); event.stopImmediatePropagation(); update(event);
  }, true);
  viewport.addEventListener('pointerup', event => {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault(); event.stopImmediatePropagation(); update(event); finish();
  }, true);
  viewport.addEventListener('pointercancel', () => finish(true));
  viewport.addEventListener('lostpointercapture', () => finish(true));
  viewport.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  doc.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select,[contenteditable]') || doc.querySelector('dialog[open]')) return;
    if (event.code === 'Space') space = true;
    if (event.key === 'Escape' && isEnabled()) { event.preventDefault(); finish(true); onExit(); }
  }, true);
  doc.addEventListener('keyup', event => { if (event.code === 'Space') space = false; });
  win.addEventListener('blur', () => { space = false; finish(true); });
  return { cancel: () => finish(true) };
}
