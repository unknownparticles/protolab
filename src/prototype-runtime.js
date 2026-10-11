import { visibilityLayout } from './visibility.js';
import { containerLayout } from './containers.js';
import { fitItemText } from './typography.js';
/** 固定的原型交互脚本；组件代码仍只允许静态内容。 */
function runPrototype(layoutItems, layoutContainers, fitText) {
  const pages = [...document.querySelectorAll('[data-prototype-page]')];
  const popups = [...document.querySelectorAll('dialog[data-prototype-popup]')];
  const body = document.body;
  let current = body.dataset.startPage;
  const trail = [];
  let opened = [];
  let toastTimer, currentToast;
  const findPopup = id => popups.find(popup => popup.dataset.prototypePopup === id);
  const backButton = document.getElementById('prototypeBack');
  function closePopups() { for (const popup of [...opened].reverse()) popup.close(); opened = []; }
  function showPage(id, remember = true) {
    const page = pages.find(page => page.dataset.prototypePage === id);
    if (!page) return;
    if (remember && id !== current) trail.push(current);
    closePopups(); closeToast(); current = id;
    for (const value of pages) { value.hidden = value !== page; value.inert = value !== page; }
    if (backButton) backButton.disabled = !trail.length;
    const label = document.getElementById('prototypePageName');
    if (label) label.textContent = page.dataset.pageName;
    if (remember) page.focus({ preventScroll: true });
    updateLayout();
  }
  function openPopup(id) {
    const popup = findPopup(id);
    if (!popup || popup.open) return;
    popup.showModal(); opened.push(popup);
    updateLayout();
  }
  function back() {
    if (opened.length) opened.at(-1).close();
    else if (trail.length) showPage(trail.pop(), false);
  }
  function closeToast() {
    clearTimeout(toastTimer);
    currentToast?.hidePopover(); currentToast = null;
  }
  function showToast(id, duration = 2500, persistent = false) {
    const toast = [...document.querySelectorAll('[data-prototype-toast]')].find(value => value.dataset.prototypeToast === id);
    if (!toast) return;
    closeToast(); currentToast = toast; toast.showPopover();
    updateLayout();
    if (!persistent) {
      const dismiss = () => {
        if (body.classList.contains('preview-editing')) toastTimer = setTimeout(dismiss, 500);
        else closeToast();
      };
      toastTimer = setTimeout(dismiss, duration);
    }
  }
  function visibility(element) {
    const board = element.closest('[data-prototype-page],[data-prototype-popup],[data-prototype-toast]');
    const ids = JSON.parse(element.dataset.targets);
    const targets = [...board.querySelectorAll('[data-element-id]')].filter(value => ids.includes(value.dataset.elementId));
    // 混合状态也整组切换，避免板块中一半显示、一半隐藏。
    const show = element.dataset.mode === 'show' || element.dataset.mode === 'toggle' && targets.every(value => value.hidden);
    for (const target of targets) { target.dataset.visible = String(show); target.hidden = !show || target.dataset.orientationHidden === 'true'; }
    updateLayout();
    if (targets.some(target => target.contains(document.activeElement) && target.hidden)) board.focus({ preventScroll: true });
  }
  function updateLayout() {
    for (const board of document.querySelectorAll('.prototype')) {
      const nodes = [...board.children].filter(node => node.classList.contains('prototype-item'));
      const items = nodes.map(node => ({ id: node.dataset.elementId, x: parseFloat(node.style.left), y: Number(node.dataset.layoutY), width: parseFloat(node.style.width), height: parseFloat(node.style.height), visible: node.dataset.visible !== 'false', collapseSpace: node.dataset.collapseSpace !== 'false', ...(node.dataset.container ? { container: JSON.parse(node.dataset.container), padding: node.dataset.padding } : {}), ...(node.dataset.parentId ? { parentId: node.dataset.parentId, layoutBasis: JSON.parse(node.dataset.layoutBasis) } : {}) }));
      layoutItems(items, layoutContainers).forEach((item, index) => {
        const node = nodes[index];
        Object.assign(node.style, { left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` });
        const parent = item.parentId && nodes.find(value => value.dataset.elementId === item.parentId);
        node.hidden = item.visible === false || node.dataset.orientationHidden === 'true' || !!parent && parent.hidden;
        fitText(node, { growWidth: !item.parentId, maxWidth: board.clientWidth - item.x });
      });
    }
  }
  document.addEventListener('prototype-layout', updateLayout);
  function execute(element) {
    const type = element.dataset.action;
    if (type === 'navigate') showPage(element.dataset.target);
    if (type === 'back') back();
    if (type === 'openPopup') openPopup(element.dataset.target);
    if (type === 'closePopup') opened.at(-1)?.close();
    if (type === 'showToast') showToast(element.dataset.target, Number(element.dataset.duration));
    if (type === 'visibility') visibility(element);
  }
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    event.preventDefault(); execute(action);
  });
  document.addEventListener('keydown', event => {
    const action = event.target.closest('.prototype-item[data-action]');
    if (action && event.target === action && ['Enter', ' '].includes(event.key)) { event.preventDefault(); execute(action); }
  });
  for (const popup of popups) {
    popup.addEventListener('close', () => { opened = opened.filter(value => value !== popup); });
    popup.addEventListener('click', event => {
      if (event.target !== popup) return;
      const rect = popup.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) popup.close();
    });
  }
  backButton?.addEventListener('click', back);
  document.getElementById('prototypeRestart')?.addEventListener('click', () => {
    trail.length = 0;
    for (const item of document.querySelectorAll('[data-element-id]')) { item.dataset.visible = item.dataset.initialVisible; item.hidden = item.dataset.initialVisible === 'false' || item.dataset.orientationHidden === 'true'; }
    updateLayout();
    showPage(body.dataset.startPage, false);
  });
  showPage(current, false);
  updateLayout();
  if (body.dataset.initialPopup) openPopup(body.dataset.initialPopup);
  if (body.dataset.initialToast) showToast(body.dataset.initialToast, 2500, true);
}
export const PROTOTYPE_RUNTIME = `(${runPrototype.toString()})(${visibilityLayout.toString()},${containerLayout.toString()},${fitItemText.toString()});`;
export const INTERACTION_CSS = `
[hidden]{display:none!important}
.prototype-item[data-action]{cursor:pointer}.prototype-item[data-action]:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}
.prototype-page{outline:none;max-width:100%}
.prototype-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 16px;font:12px system-ui;color:#475569;max-width:100%}
.prototype-controls span{flex:1;overflow-wrap:anywhere}
.prototype-controls button,.prototype-popup-heading button{font:inherit;border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:6px 10px;color:#334155;cursor:pointer}
.prototype-controls button:disabled{opacity:.4;cursor:default}
.prototype-popup{border:0;border-radius:12px;padding:12px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);box-sizing:border-box;overflow:auto;background:#fff;color:#0f172a}
.prototype-popup::backdrop{background:#0f172a66}
.prototype-popup-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;font:12px system-ui;margin-bottom:12px}
.prototype-popup-heading h2{font-size:14px;margin:0;overflow-wrap:anywhere}
.prototype-toast{border:0;padding:0;background:transparent;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;border-radius:12px;box-shadow:0 8px 30px #0f172a33}
.prototype-toast-heading:empty{display:none}.prototype-toast-heading{padding:6px;background:#fff}
`;
