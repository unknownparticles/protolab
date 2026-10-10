import { textTargets } from './text-targets.js';
import { resizePreviewItem } from './preview-resize.js';
import { itemBounds } from './model.js';
import { orientationPresentation } from './orientation.js';

function runPreviewEditor(config, textTargets, resizeItem) {
  let editing = false, selected = null, gesture = null, textEditor = null;
  const entries = new Map();
  for (const page of config.pages) {
    const board = [...document.querySelectorAll('[data-prototype-page],[data-prototype-popup]')].find(node => (node.dataset.prototypePage || node.dataset.prototypePopup) === page.id);
    const nodes = [...board.querySelector('.prototype').children];
    page.items.forEach((item, index) => {
      const node = nodes[index]; node.dataset.previewItem = item.id;
      entries.set(`${page.id}/${item.id}`, { page, item, node });
    });
  }
  const tools = document.createElement('nav'); tools.className = 'preview-edit-tools';
  tools.setAttribute('aria-label', '预览编辑');
  const toggle = document.createElement('button'); toggle.textContent = '编辑文字与尺寸'; toggle.type = 'button'; toggle.setAttribute('aria-pressed', 'false');
  const hint = document.createElement('span'); hint.textContent = '点击组件体验跳转与弹窗';
  tools.append(toggle, hint); document.body.prepend(tools);
  const lookup = node => [...entries.values()].find(entry => entry.node === node);
  function send(entry, change) {
    parent.postMessage({ type: 'protolab-preview-edit', token: config.token, pageId: entry.page.id, itemId: entry.item.id, ...change }, '*');
  }
  function position(entry) {
    for (const key of ['x', 'y', 'width', 'height']) entry.node.style[{ x: 'left', y: 'top' }[key] || key] = `${entry.item[key]}px`;
    if (entry.overlay) {
      entry.overlay.style.cssText = `left:${entry.item.x}px;top:${entry.item.y}px;width:${entry.item.width}px;height:${entry.item.height}px;transform:rotate(${entry.item.angle}deg)`;
    }
  }
  function select(entry) {
    if (selected === entry) return;
    selected?.overlay?.remove(); if (selected) selected.overlay = null;
    selected = entry;
    if (!entry) return;
    const overlay = document.createElement('div'); overlay.className = 'preview-selection';
    for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handle = document.createElement('button'); handle.type = 'button'; handle.dataset.resize = direction;
      handle.className = `preview-resize ${direction}`; handle.setAttribute('aria-label', `调整尺寸 ${direction}`);
      overlay.append(handle);
    }
    entry.node.parentElement.append(overlay); entry.overlay = overlay; position(entry);
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const old = gesture; gesture = null;
    if (cancel) Object.assign(old.entry.item, old.start);
    else if (['x', 'y', 'width', 'height'].some(key => old.start[key] !== old.entry.item[key])) send(old.entry, { kind: 'resize', geometry: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, old.entry.item[key]])) });
    position(old.entry);
    if (old.handle.hasPointerCapture(old.pointerId)) old.handle.releasePointerCapture(old.pointerId);
  }
  function closeTextEditor() { textEditor?.remove(); textEditor = null; }
  function editText(entry, event) {
    closeTextEditor();
    const targets = textTargets(entry.node.querySelector('.prototype-content'));
    if (!targets.length) { hint.textContent = '此组件没有可编辑文字，可拖动控制点调整尺寸'; return; }
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const direct = targets.filter(target => target.node === range?.startContainer || target.node === event.target);
    const nearby = targets.filter(target => event.target.contains(target.node));
    const chosen = direct.length ? direct : nearby.length ? nearby : targets;
    const form = document.createElement('form'); form.className = 'preview-text-editor'; form.setAttribute('aria-label', '编辑组件文字');
    const title = document.createElement('strong'); title.textContent = '编辑文字'; form.append(title);
    const fields = chosen.map(target => {
      const label = document.createElement('label'); label.textContent = target.label;
      const input = document.createElement('textarea'); input.value = target.value; input.rows = 2; input.setAttribute('aria-label', target.label);
      label.append(input); form.append(label); return { index: targets.indexOf(target), input };
    });
    const actions = document.createElement('div'); actions.className = 'preview-text-actions';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = '保存文字';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = closeTextEditor;
    actions.append(cancel, save); form.append(actions);
    form.addEventListener('submit', event => { event.preventDefault(); send(entry, { kind: 'text', changes: fields.map(({ index, input }) => ({ index, value: input.value })) }); closeTextEditor(); });
    form.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTextEditor(); } });
    (entry.node.closest('dialog[open]') || document.body).append(form); textEditor = form;
    const rect = entry.node.getBoundingClientRect();
    form.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - form.offsetWidth - 8))}px`;
    form.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - form.offsetHeight - 8))}px`;
    fields[0].input.focus(); fields[0].input.select();
  }
  toggle.addEventListener('click', () => {
    finish(true); closeTextEditor(); editing = !editing; select(null);
    document.body.classList.toggle('preview-editing', editing); toggle.setAttribute('aria-pressed', String(editing));
    hint.textContent = editing ? '双击文字编辑 · 拖动边缘或角点调整尺寸 · 修改自动保存' : '点击组件体验跳转与弹窗';
  });
  document.addEventListener('click', event => {
    if (!editing || event.target.closest('.preview-edit-tools,.preview-text-editor')) return;
    const node = event.target.closest('[data-preview-item],.preview-selection');
    if (node) { event.preventDefault(); event.stopImmediatePropagation(); if (node.dataset.previewItem) select(lookup(node)); }
    else if (event.target.closest('.prototype')) select(null);
  }, true);
  document.addEventListener('dblclick', event => {
    if (!editing || event.target.closest('.preview-text-editor')) return;
    const entry = lookup(event.target.closest('[data-preview-item]')); if (!entry) return;
    event.preventDefault(); event.stopImmediatePropagation(); select(entry); editText(entry, event);
  }, true);
  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-resize]');
    if (!editing || !selected || !handle || event.button !== 0 || gesture) return;
    event.preventDefault(); closeTextEditor();
    gesture = { entry: selected, handle, direction: handle.dataset.resize, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      start: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, selected.item[key]])) };
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const g = gesture;
    Object.assign(g.entry.item, resizeItem(g.start, g.direction, event.clientX - g.clientX, event.clientY - g.clientY, g.entry.page.bounds, g.entry.item.angle));
    position(g.entry);
  });
  document.addEventListener('pointerup', event => { if (event.pointerId === gesture?.pointerId) finish(); });
  document.addEventListener('pointercancel', event => { if (event.pointerId === gesture?.pointerId) finish(true); });
  document.addEventListener('lostpointercapture', event => { if (event.pointerId === gesture?.pointerId) finish(true); });
  document.addEventListener('keydown', event => {
    if (!editing || event.target.closest('.preview-text-editor,.preview-edit-tools')) return;
    if (event.key === 'Escape' && (gesture || selected)) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); select(null); }
    if (event.target.closest('[data-preview-item],.preview-selection') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.token !== config.token || event.data.type !== 'protolab-preview-result') return;
    const entry = entries.get(`${event.data.pageId}/${event.data.itemId}`); if (!entry) return;
    if (event.data.error) { Object.assign(entry.item, event.data.item); position(entry); hint.textContent = event.data.error; return; }
    Object.assign(entry.item, event.data.item);
    const template = document.createElement('template'); template.innerHTML = event.data.html;
    const node = template.content.firstElementChild; node.dataset.previewItem = entry.item.id;
    entry.node.replaceWith(node); entry.node = node; position(entry);
    hint.textContent = '修改已同步 · 双击文字编辑 · 拖动控制点调整尺寸';
  });
  // 弹窗关闭或页面跳转后清理选框，防止编辑状态停留在不可见页面。
  new MutationObserver(() => {
    if (selected && (!selected.node.getClientRects().length || selected.node.closest('dialog:not([open])'))) { finish(true); closeTextEditor(); select(null); }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
}

export function previewEditorScript(project, token) {
  const config = { token, pages: project.pages.map(page => ({ id: page.id, bounds: itemBounds(page), items: page.items.map(item => ({ id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, angle: orientationPresentation(item, page.canvas).angle })) })) };
  return `(${runPreviewEditor.toString()})(${JSON.stringify(config).replace(/</g, '\\u003c')},${textTargets.toString()},${resizePreviewItem.toString()});`;
}

export const PREVIEW_EDIT_CSS = `
.preview-edit-tools{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;font:12px system-ui;color:#475569}
.preview-edit-tools button,.preview-text-editor button{font:inherit;border:1px solid #cbd5e1;border-radius:6px;background:white;padding:7px 12px;cursor:pointer;color:#334155}
.preview-edit-tools button[aria-pressed=true],.preview-text-editor button[type=submit]{background:#2563eb;color:white;border-color:#2563eb}
.preview-editing .prototype-item{cursor:default}.preview-editing .prototype-content{cursor:text}
.preview-selection{position:absolute;box-sizing:border-box;border:2px solid #2563eb;z-index:1000;pointer-events:none}
.preview-resize{position:absolute;width:12px;height:12px;background:white;border:1px solid #2563eb;padding:0;border-radius:2px;pointer-events:auto;touch-action:none}
.preview-resize.nw{left:-6px;top:-6px;cursor:nwse-resize}.preview-resize.ne{right:-6px;top:-6px;cursor:nesw-resize}.preview-resize.sw{left:-6px;bottom:-6px;cursor:nesw-resize}.preview-resize.se{right:-6px;bottom:-6px;cursor:nwse-resize}
.preview-resize.n{left:calc(50% - 6px);top:-6px;cursor:ns-resize}.preview-resize.s{left:calc(50% - 6px);bottom:-6px;cursor:ns-resize}.preview-resize.e{right:-6px;top:calc(50% - 6px);cursor:ew-resize}.preview-resize.w{left:-6px;top:calc(50% - 6px);cursor:ew-resize}
.preview-text-editor{position:fixed;z-index:2000;width:min(300px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;box-sizing:border-box;background:white;color:#0f172a;border:1px solid #93c5fd;border-radius:10px;padding:12px;box-shadow:0 8px 24px #0f172a33;font:12px system-ui}
.preview-text-editor label{display:block;margin-top:10px}.preview-text-editor textarea{display:block;box-sizing:border-box;width:100%;font:14px system-ui;border:1px solid #cbd5e1;border-radius:6px;padding:8px;margin-top:5px;resize:vertical}.preview-text-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
`;
