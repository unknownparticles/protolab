/** 使用独立文本节点和表单属性，保留卡片、标签及矢量图形的结构。 */
export function textTargets(fragment) {
  const targets = [];
  const visit = node => {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) targets.push({ node, label: '文本', value: node.textContent });
      return;
    }
    if (node.nodeType === 1) {
      if (['title', 'desc', 'defs', 'style'].includes(node.localName)) return;
      if (node.hasAttribute('data-protolab-text') && ![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) {
        const empty = [...node.childNodes].find(child => child.nodeType === 3) || node.appendChild(document.createTextNode(''));
        targets.push({ node: empty, label: '文本', value: empty.textContent });
      }
      if (['input', 'textarea'].includes(node.localName)) {
        if (node.hasAttribute('placeholder')) targets.push({ node, attribute: 'placeholder', label: '输入提示', value: node.getAttribute('placeholder') });
        if (node.localName === 'textarea') { targets.push({ node, label: '输入内容', value: node.textContent }); return; }
        if (!['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(node.getAttribute('type'))) targets.push({ node, attribute: 'value', label: '输入内容', value: node.getAttribute('value') || '' });
      }
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(fragment);
  return targets;
}

