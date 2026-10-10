import { textTargets } from './text-targets.js';
import { isImageData, sanitizeContent } from './content.js';
import { MAX_IMAGE } from './model.js';

function contentDocument(item) {
  const template = document.createElement('template');
  if (item.type !== 'image') template.innerHTML = item.content;
  return template;
}


export function editableContent(item) {
  const template = contentDocument(item);
  const texts = textTargets(template.content).map(({ label, value }, index) => ({ label: `${label} ${index + 1}`, value }));
  const images = item.type === 'image' ? [{ label: '图片 1', source: item.content }] : [...template.content.querySelectorAll('img, svg image')].map((node, index) => ({ label: node.getAttribute('alt') || `图片 ${index + 1}`, source: node.getAttribute('src') || node.getAttribute('href') || '', vector: node.localName === 'image' }));
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
      if (node.nodeType === 3 && !values[index].trim()) {
        if (!node.parentElement) { const span = document.createElement('span'); node.replaceWith(span); span.append(node); }
        node.parentElement.setAttribute('data-protolab-text', 'true');
      }
      else if (node.nodeType === 3) node.parentElement?.removeAttribute('data-protolab-text');
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
