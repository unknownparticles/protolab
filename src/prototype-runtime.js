/** 固定的原型交互脚本；组件代码仍只允许静态内容。 */
function runPrototype() {
  const pages = [...document.querySelectorAll('[data-prototype-page]')];
  const popups = [...document.querySelectorAll('dialog[data-prototype-popup]')];
  const body = document.body;
  let current = body.dataset.startPage;
  const trail = [];
  let opened = [];
  const findPopup = id => popups.find(popup => popup.dataset.prototypePopup === id);
  const backButton = document.getElementById('prototypeBack');
  function closePopups() { for (const popup of [...opened].reverse()) popup.close(); opened = []; }
  function showPage(id, remember = true) {
    const page = pages.find(page => page.dataset.prototypePage === id);
    if (!page) return;
    if (remember && id !== current) trail.push(current);
    closePopups(); current = id;
    for (const value of pages) { value.hidden = value !== page; value.inert = value !== page; }
    if (backButton) backButton.disabled = !trail.length;
    const label = document.getElementById('prototypePageName');
    if (label) label.textContent = page.dataset.pageName;
    if (remember) page.focus({ preventScroll: true });
  }
  function openPopup(id) {
    const popup = findPopup(id);
    if (!popup || popup.open) return;
    popup.showModal(); opened.push(popup);
  }
  function back() {
    if (opened.length) opened.at(-1).close();
    else if (trail.length) showPage(trail.pop(), false);
  }
  function execute(element) {
    const type = element.dataset.action;
    if (type === 'navigate') showPage(element.dataset.target);
    if (type === 'back') back();
    if (type === 'openPopup') openPopup(element.dataset.target);
    if (type === 'closePopup') opened.at(-1)?.close();
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
  document.getElementById('prototypeRestart')?.addEventListener('click', () => { trail.length = 0; showPage(body.dataset.startPage, false); });
  showPage(current, false);
  if (body.dataset.initialPopup) openPopup(body.dataset.initialPopup);
}
export const PROTOTYPE_RUNTIME = `(${runPrototype.toString()})();`;
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
`;
