/** 顶部两级菜单：管理展开、焦点和键盘操作，业务操作仍由原按钮处理。 */
export function initializeMenus(root) {
  const triggers = [...root.querySelectorAll('.menu-trigger')];
  const menus = triggers.map(trigger => document.getElementById(trigger.getAttribute('aria-controls')));
  let opened = -1;
  const items = index => [...menus[index].querySelectorAll('button:not(:disabled)')];
  function focusTrigger(index) {
    triggers.forEach((trigger, position) => { trigger.tabIndex = position === index ? 0 : -1; });
    triggers[index].focus();
  }
  function close(focus = false) {
    if (opened < 0) return;
    const index = opened;
    menus[index].hidden = true;
    triggers[index].setAttribute('aria-expanded', 'false');
    opened = -1;
    if (focus) focusTrigger(index);
  }
  function open(index, focus = null) {
    close();
    opened = index;
    const menu = menus[index];
    menu.hidden = false;
    triggers[index].setAttribute('aria-expanded', 'true');
    triggers.forEach((trigger, position) => { trigger.tabIndex = position === index ? 0 : -1; });
    const bounds = triggers[index].getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${bounds.bottom + 8}px`;
    menu.style.maxHeight = `${Math.max(0, window.innerHeight - bounds.bottom - 20)}px`;
    if (focus) items(index)[focus === 'last' ? 'at' : 'slice'](-1);
    if (focus === 'first') items(index)[0]?.focus();
    if (focus === 'last') items(index).at(-1)?.focus();
  }
  triggers.forEach((trigger, index) => {
    trigger.addEventListener('click', () => {
      if (opened === index) close(true);
      else open(index);
    });
    trigger.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' && opened >= 0 && opened !== index) { open(index); focusTrigger(index); }
    });
    trigger.addEventListener('focus', () => {
      triggers.forEach((value, position) => { value.tabIndex = position === index ? 0 : -1; });
    });
  });
  // 在业务处理之前收起菜单，使弹窗获得焦点，并保留浏览器的文件选择与下载手势。
  root.addEventListener('click', event => {
    const item = event.target.closest('.menu-dropdown button');
    if (item && !item.disabled) close(true);
  }, true);
  root.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) { close(true); return; }
    const trigger = event.target.closest('.menu-trigger');
    const index = trigger ? triggers.indexOf(trigger) : opened;
    if (index < 0) return;
    const choices = items(index);
    const position = choices.indexOf(document.activeElement);
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length;
      const expanded = opened >= 0;
      focusTrigger(next);
      if (expanded) open(next, trigger ? null : 'first');
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (trigger) open(index, ['ArrowUp', 'End'].includes(event.key) ? 'last' : 'first');
      else if (choices.length) {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (position + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[next].focus();
      }
    } else if (event.key === 'Escape' && opened >= 0) close(true);
    else if (event.key === 'Tab') { close(true); return; }
    else return;
    event.preventDefault();
  });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!root.contains(event.target)) close(); });
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close(true));
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  root.querySelectorAll('[data-shortcut]').forEach(label => { label.textContent = `${modifier} ${label.dataset.shortcut}`; });
}
