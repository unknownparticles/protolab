import { itemHTML, PROTOTYPE_CSS } from './content.js';
import { fitItemText } from './typography.js';

function fitPreview(host) {
  const item = host.shadowRoot?.querySelector('.prototype-item');
  if (!item) return;
  fitItemText(item);
  const scale = Math.max(0, Math.min(1, (host.clientWidth - 24) / parseFloat(item.style.width), (host.clientHeight - 24) / parseFloat(item.style.height)));
  item.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
const observer = new ResizeObserver(entries => entries.forEach(({ target }) => fitPreview(target)));

/** 使用画布的内容结构，隔离页面样式并按默认尺寸等比缩放。内容须先经过清理。 */
export function renderComponentPreview(host, component) {
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${PROTOTYPE_CSS}
    :host{display:block;overflow:hidden;pointer-events:none}
    .prototype{width:100%;height:100%;background:transparent}
    .prototype-item{left:50%!important;top:50%!important;pointer-events:none}
  `;
  const stage = document.createElement('div');
  stage.className = 'prototype';
  stage.inert = true;
  stage.innerHTML = itemHTML({ ...component, x: 0, y: 0, width: component.defaultWidth, height: component.defaultHeight, radius: component.defaultRadius ?? (component.type === 'svg' ? 0 : 8), padding: component.padding ?? '0', margin: component.margin ?? '0' });
  root.replaceChildren(style, stage);
  observer.observe(host);
  fitPreview(host);
}

export function clearComponentPreview(host) {
  observer.unobserve(host);
  host.shadowRoot?.replaceChildren();
}
