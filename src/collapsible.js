const STORAGE_KEY = 'protolab.collapsedSections';

/** 收起只改变界面，不改变表单值、组件选择或工程历史。 */
export function initializeCollapsible(root = document) {
  let state = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) state = saved;
  } catch { /* 浏览器禁用存储时仍可收起。 */ }
  const save = (key, collapsed) => {
    state[key] = collapsed;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 不影响编辑。 */ }
  };

  root.querySelectorAll('[data-collapsible]').forEach(section => {
    const key = section.dataset.collapsible;
    let heading = section.querySelector(':scope > .section-label, :scope > legend, :scope > strong');
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'section-label';
      heading.textContent = section.dataset.collapseTitle;
      section.prepend(heading);
    }
    const title = heading.cloneNode(true);
    title.querySelectorAll('span').forEach(node => node.remove());
    const label = title.textContent.trim();
    const content = document.createElement('div');
    content.className = 'collapse-content';
    content.id = `collapse-${key}`;
    for (const node of [...section.childNodes]) if (node !== heading) content.append(node);
    section.append(content);
    section.classList.add('collapsible-section');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-toggle';
    button.setAttribute('aria-controls', content.id);
    button.append(...heading.childNodes);
    heading.append(button);
    const update = collapsed => {
      content.hidden = collapsed;
      section.classList.toggle('section-collapsed', collapsed);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${label}`);
    };
    update(state[key] === true);
    button.addEventListener('click', () => { update(!content.hidden); save(key, content.hidden); });
    // 原生校验发现收起的必填字段时先展开，保证错误可以定位。
    content.addEventListener('invalid', () => { update(false); save(key, false); }, true);
  });

  root.querySelectorAll('[data-collapsible-panel]').forEach(panel => {
    const key = panel.dataset.collapsiblePanel;
    const heading = panel.querySelector(':scope > .panel-heading');
    const title = heading.querySelector('h1,h2').textContent;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-toggle';
    const label = document.createElement('span');
    label.className = 'panel-toggle-label';
    label.textContent = title;
    button.append(label);
    const contents = [...panel.children].filter(node => node !== heading);
    contents.forEach((node, index) => { if (!node.id) node.id = `collapse-${key}-${index}`; });
    button.setAttribute('aria-controls', contents.map(node => node.id).join(' '));
    heading.append(button);
    const update = collapsed => {
      panel.classList.toggle('panel-collapsed', collapsed);
      contents.forEach(node => { node.inert = collapsed; });
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', `${collapsed ? '展开' : '收起'}${title}`);
      button.title = `${collapsed ? '展开' : '收起'}${title}`;
    };
    update(state[key] === true);
    button.addEventListener('click', () => {
      const collapsed = !panel.classList.contains('panel-collapsed');
      update(collapsed); save(key, collapsed);
    });
    panel.addEventListener('invalid', () => { update(false); save(key, false); }, true);
  });
}
