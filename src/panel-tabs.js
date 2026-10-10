/** 标签切换不重建表单，保留未提交的编辑值和面板滚动位置。 */
export function initializeTabs(tablist, attribute, onChange = () => {}) {
  const tabs = [...tablist.querySelectorAll('[role=tab]')];
  const activate = (value, focus = false) => {
    for (const tab of tabs) {
      const active = tab.getAttribute(attribute) === value;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
    onChange(value);
  };
  tablist.addEventListener('click', event => {
    const tab = event.target.closest('[role=tab]');
    if (tab) activate(tab.getAttribute(attribute));
  });
  tablist.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    activate(tabs[next].getAttribute(attribute), true);
  });
  return activate;
}
