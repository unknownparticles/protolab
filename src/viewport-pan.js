/** 画布超出窗口时拖动空白区域，或使用空格、中键平移；组件仍可直接拖动。 */
export function attachViewportPan(viewport, { beforePan = () => {}, onBlankClick = () => {}, canBlankPan = () => true } = {}) {
  const doc = viewport.ownerDocument, win = doc.defaultView;
  let gesture = null, space = false, suppressClick = false;
  const editable = target => target.closest('input,textarea,select,[contenteditable],button,a,[role="button"]');
  const overflows = () => viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight;
  function updateCursor() {
    viewport.classList.toggle('can-pan', overflows());
    viewport.classList.toggle('pan-ready', space && overflows());
    viewport.classList.toggle('is-panning', !!gesture?.moved);
  }
  function cancel() {
    if (gesture) {
      const old = gesture; gesture = null;
      suppressClick = old.moved;
      if (viewport.hasPointerCapture(old.id)) viewport.releasePointerCapture(old.id);
    }
    updateCursor();
  }
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || gesture || !overflows() || editable(event.target)) return;
    if (event.button !== 1 && (event.button !== 0 || (!space && event.target.closest('.editor-item')))) return;
    if (event.button === 0 && !space && !canBlankPan()) return;
    // 保留原生滚动条的拖动操作。
    const rect = viewport.getBoundingClientRect();
    if (event.clientX >= rect.left + viewport.clientWidth || event.clientY >= rect.top + viewport.clientHeight) return;
    event.preventDefault(); event.stopImmediatePropagation(); beforePan();
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, target: event.target, blank: event.button === 0 && !space, moved: false };
    viewport.setPointerCapture(event.pointerId);
  }, true);
  viewport.addEventListener('pointermove', event => {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    viewport.scrollLeft = gesture.left - dx;
    viewport.scrollTop = gesture.top - dy;
    updateCursor();
  }, true);
  viewport.addEventListener('pointerup', event => {
    if (event.pointerId !== gesture?.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const old = gesture; cancel();
    if (!old.moved && old.blank) onBlankClick(old.target);
  }, true);
  viewport.addEventListener('pointercancel', cancel);
  viewport.addEventListener('lostpointercapture', cancel);
  viewport.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  viewport.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && gesture) { event.preventDefault(); cancel(); return; }
    if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || editable(event.target) || doc.querySelector('dialog[open]') || !overflows()) return;
    event.preventDefault(); space = true; updateCursor();
  });
  doc.addEventListener('keyup', event => {
    if (event.code === 'Space') { space = false; updateCursor(); }
  });
  win.addEventListener('blur', () => { space = false; cancel(); });
  const observer = new win.ResizeObserver(updateCursor);
  observer.observe(viewport);
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
  updateCursor();
  return { cancel };
}
