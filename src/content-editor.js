import { isImageData, sanitizeContent } from './content.js';
import { MAX_IMAGE } from './model.js';

function contentDocument(item) {
  const template = document.createElement('template');
  if (item.type !== 'image') template.innerHTML = item.content;
  return template;
}

/** 使用独立文本节点和表单属性，保留卡片、标签及矢量图形的结构。 */
function textTargets(fragment) {
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

export function editableContent(item) {
  const template = contentDocument(item);
  const texts = textTargets(template.content).map(({ label, value }, index) => ({ label: `${label} ${index + 1}`, value }));
  const images = item.type === 'image' ? [{ label: '图片 1', source: item.content }] : [...template.content.querySelectorAll('img, svg image')].map((node, index) => ({ label: node.getAttribute('alt') || `图片 ${index + 1}`, source: node.getAttribute('src') || node.getAttribute('href') || '' }));
  if (!images.length && item.imageSlot) images.push({ label: '设置图片', source: '' });
  return { texts, images };
}

export function updateTextContent(item, values) {
  if (item.type === 'image') return item.content;
  const template = contentDocument(item);
  const targets = textTargets(template.content);
  if (targets.length !== values.length) throw new Error('组件内容已变化，请重新选择组件');
  targets.forEach(({ node, attribute }, index) => {
    if (attribute) node.setAttribute(attribute, values[index]);
    else {
      node.textContent = values[index];
      if (node.nodeType === 3 && !values[index].trim()) node.parentElement.setAttribute('data-protolab-text', 'true');
      else if (node.nodeType === 3) node.parentElement.removeAttribute('data-protolab-text');
    }
  });
  return sanitizeContent(template.innerHTML, item.type);
}

export function updateImageContent(item, index, source) {
  if (!isImageData(source)) throw new Error('请上传有效图片或粘贴内嵌图片数据');
  if (source.length > MAX_IMAGE * 1.4) throw new Error('图片不能超过 3 MB');
  if (item.type === 'image') return source;
  const template = contentDocument(item);
  const images = [...template.content.querySelectorAll('img, svg image')];
  if (!images.length && item.imageSlot && index === 0) {
    const img = document.createElement('img');
    img.src = source; img.alt = item.name;
    img.style.cssText = `width:100%;height:100%;object-fit:contain;border-radius:${template.content.firstElementChild?.style.borderRadius || 'inherit'}`;
    template.content.replaceChildren(img);
  } else {
    const image = images[index];
    if (!image) throw new Error('图片位置已变化，请重新选择组件');
    image.setAttribute(image.localName === 'image' ? 'href' : 'src', source);
    // 新图片应覆盖导入内容中的旧候选资源。
    image.removeAttribute('srcset');
  }
  return sanitizeContent(template.innerHTML, item.type);
}
