import { t } from './i18n.js';
import { textTargets } from './text-targets.js';

/** 在画布文字旁直接编辑，独立更新文本节点，保留组件结构与点击动作。 */
export function createCanvasTextEditor({ apply, notify }) {
  let session = null;
  function finish(cancel = false) {
    if (!session) return;
    const old = session; session = null;
    try {
      if (!cancel) apply(old.item, old.fields.map(({ index, input }) => ({ index, value: input.value })));
      old.form.remove();
    } catch (error) {
      session = old; notify(error.message, true); old.fields[0].input.focus();
      return false;
    }
    return true;
  }
  function open(item, node, event) {
    if (finish() === false) return;
    const targets = textTargets(node.querySelector('.prototype-content'));
    if (!targets.length) { notify(t('此组件没有可编辑文字，可拖动控制点调整尺寸')); return; }
    // 原型内容保持 inert，通过文字实际矩形命中，避免触发表单或跳转。
    const hit = targets.filter(({ node }) => {
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = node.nodeType === 3 ? range.getClientRects() : [node.getBoundingClientRect()];
      return [...rects].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    });
    const chosen = hit.length ? hit : targets;
    const form = document.createElement('form'); form.className = 'canvas-text-editor';
    form.setAttribute('aria-label', t('编辑组件文字'));
    const fields = chosen.map(target => {
      const label = document.createElement('label'); label.textContent = t(target.label);
      const input = document.createElement('textarea'); input.rows = 2; input.value = target.value;
      input.setAttribute('aria-label', t(target.label)); label.append(input); form.append(label);
      return { index: targets.indexOf(target), input };
    });
    const help = document.createElement('small'); help.textContent = t('回车保存 · Shift + 回车换行 · Esc 取消');
    const actions = document.createElement('div'); actions.className = 'canvas-text-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-sm'; cancel.textContent = t('取消');
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'btn btn-primary btn-sm'; save.textContent = t('保存文字');
    cancel.addEventListener('click', () => finish(true)); actions.append(cancel, save); form.append(help, actions);
    form.addEventListener('submit', event => { event.preventDefault(); finish(); });
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.stopPropagation(); finish(); }
    });
    form.addEventListener('focusout', () => queueMicrotask(() => {
      if (session?.form === form && !form.contains(document.activeElement)) finish();
    }));
    document.body.append(form); session = { item: { ...item }, form, fields };
    const rect = node.getBoundingClientRect();
    form.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - form.offsetWidth - 8))}px`;
    form.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - form.offsetHeight - 8))}px`;
    fields[0].input.focus(); fields[0].input.select();
  }
  document.addEventListener('pointerdown', event => {
    if (session && !session.form.contains(event.target) && finish() === false) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  return { open, finish, get active() { return !!session; } };
}
