/** 围绕鼠标或双指中心缩放，保留该位置对应的内容坐标。 */
export function attachViewportZoom(viewport, content, { getZoom, setZoom, beforeZoom = () => {} }) {
  let pinch = null, safariPinch = null, suppressClickUntil = 0;
  const excluded = target => target.closest('textarea,input,select,[contenteditable],.preview-text-editor');
  function zoomAt(value, clientX, clientY, previousX = clientX, previousY = clientY) {
    if (!Number.isFinite(value)) return;
    beforeZoom();
    const oldZoom = getZoom();
    const nextZoom = Math.round(Math.max(.1, Math.min(4, value)) * 10000) / 10000;
    const rect = content.getBoundingClientRect();
    const x = (previousX - rect.left) / oldZoom, y = (previousY - rect.top) / oldZoom;
    setZoom(nextZoom);
    const next = content.getBoundingClientRect();
    viewport.scrollLeft += next.left + x * nextZoom - clientX;
    viewport.scrollTop += next.top + y * nextZoom - clientY;
  }
  viewport.addEventListener('wheel', event => {
    if (excluded(event.target) || !event.deltaY) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
    zoomAt(getZoom() * Math.exp(-delta * .002), event.clientX, event.clientY);
  }, { passive: false });
  const pair = touches => {
    const a = [...touches].find(touch => touch.identifier === pinch?.ids[0]);
    const b = [...touches].find(touch => touch.identifier === pinch?.ids[1]);
    return a && b ? { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) } : null;
  };
  viewport.addEventListener('touchstart', event => {
    if (event.touches.length !== 2 || excluded(event.target)) return;
    event.preventDefault(); beforeZoom();
    pinch = { ids: [...event.touches].map(touch => touch.identifier), zoom: getZoom() };
    Object.assign(pinch, pair(event.touches));
    suppressClickUntil = Date.now() + 500;
  }, { passive: false });
  viewport.addEventListener('touchmove', event => {
    if (!pinch) return;
    event.preventDefault();
    const next = pair(event.touches);
    if (next && pinch.distance > 0) {
      zoomAt(pinch.zoom * next.distance / pinch.distance, next.x, next.y, pinch.x, pinch.y);
      pinch.x = next.x; pinch.y = next.y;
    }
  }, { passive: false });
  const endPinch = event => {
    if (!pinch) return;
    suppressClickUntil = Date.now() + 500;
    if (!pair(event.touches)) pinch = null;
  };
  viewport.addEventListener('touchend', endPinch);
  viewport.addEventListener('touchcancel', endPinch);
  // Safari 的触控板捏合使用手势事件。
  viewport.addEventListener('gesturestart', event => {
    if (excluded(event.target)) return;
    event.preventDefault(); beforeZoom(); safariPinch = getZoom();
  }, { passive: false });
  viewport.addEventListener('gesturechange', event => {
    if (safariPinch === null) return;
    event.preventDefault(); zoomAt(safariPinch * event.scale, event.clientX, event.clientY);
  }, { passive: false });
  viewport.addEventListener('gestureend', event => { if (safariPinch !== null) event.preventDefault(); safariPinch = null; }, { passive: false });
  viewport.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  return { reset() {
    const rect = viewport.getBoundingClientRect();
    zoomAt(1, rect.left + viewport.clientWidth / 2, rect.top + viewport.clientHeight / 2);
  } };
}
