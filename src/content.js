/** 组件只承载静态标记，移除脚本、事件、页面级样式及外部资源。 */
const HTML_TAGS = new Set('div span p strong b em i u s small h1 h2 h3 h4 h5 h6 section article header footer main nav aside ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col label button input textarea select option img a br hr pre code blockquote figure figcaption'.split(' '));
const SVG_TAGS = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask title desc'.split(' '));
const REMOVE = new Set('script style iframe object embed link meta base form foreignobject animate animatetransform set use'.split(' '));
const ATTRS = new Set('title alt placeholder value type disabled checked selected readonly multiple rows cols maxlength min max step role tabindex width height viewbox fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule d x y x1 x2 y1 y2 cx cy r rx ry points opacity fill-opacity stroke-opacity transform preserveaspectratio offset stop-color stop-opacity gradientunits gradienttransform spreadmethod'.split(' '));
const STYLES = new Set('display position flex flex-direction flex-wrap flex-grow flex-shrink align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row width height min-width min-height max-width max-height top right bottom left margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left background background-color color border border-width border-style border-color border-top border-right border-bottom border-left border-radius box-shadow box-sizing overflow overflow-x overflow-y opacity font-size font-family font-weight font-style line-height letter-spacing text-align text-decoration text-transform white-space word-break object-fit object-position vertical-align cursor'.split(' '));
export function isImageData(value) {
  return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/.test(value);
}
export function sanitizeContent(content, type = 'html') {
  if (type === 'image') {
    if (!isImageData(content)) throw new Error('图片仅支持 PNG、JPEG、GIF、WebP 或 AVIF 的内嵌数据');
    return content;
  }
  const template = document.createElement('template');
  template.innerHTML = content;
  for (const element of [...template.content.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase();
    if (REMOVE.has(tag) || !(HTML_TAGS.has(tag) || SVG_TAGS.has(tag))) { element.remove(); continue; }
    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === 'style') {
        const clean = document.createElement('span').style;
        for (const property of [...element.style]) {
          const value = element.style.getPropertyValue(property);
          if (STYLES.has(property) && !/(?:url\s*\(|image-set\s*\(|expression\s*\(|var\s*\(|https?:|data:|@|\\)/i.test(value) && !(property === 'position' && ['fixed', 'sticky'].includes(value))) clean.setProperty(property, value);
        }
        element.setAttribute('style', clean.cssText);
      } else if (name === 'src' && tag === 'img' && isImageData(attr.value)) {
        continue;
      } else if (!ATTRS.has(name) && !/^aria-[a-z-]+$/.test(name)) {
        element.removeAttribute(attr.name);
      } else if (/(?:url\s*\(|javascript:|data:|https?:|\\)/i.test(attr.value) && ['fill', 'stroke'].includes(name)) {
        element.removeAttribute(attr.name);
      }
    }
  }
  if (type === 'svg' && !template.content.querySelector('svg')) throw new Error('SVG 组件需要包含有效的 <svg> 元素');
  return template.innerHTML.trim();
}
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
/** 编辑、预览和导出共用结构，确保尺寸、边距及零圆角一致。 */
export function itemHTML(item) {
  const inner = item.type === 'image' ? `<img src="${escapeHTML(item.content)}" alt="${escapeHTML(item.name)}" style="width:100%;height:100%;object-fit:contain">` : item.content;
  return `<div class="prototype-item" data-name="${escapeHTML(item.name)}" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px;border-radius:${item.radius}px;padding:${escapeHTML(item.padding)}"><div class="prototype-content" style="margin:${escapeHTML(item.margin)}">${inner}</div></div>`;
}
export const PROTOTYPE_CSS = `
.prototype{position:relative;background:#fff;overflow:hidden;color:#0f172a;font-family:Inter,system-ui,-apple-system,sans-serif}
.prototype-item{position:absolute;box-sizing:border-box;display:flex;align-items:stretch;overflow:hidden;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.06);isolation:isolate}
.prototype-content{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:inherit}
.prototype-content *{box-sizing:border-box;font-family:inherit}
.prototype-content p,.prototype-content h1,.prototype-content h2,.prototype-content h3{margin:0}
.prototype-content input,.prototype-content textarea,.prototype-content button{font-family:inherit}
`;
export function exportHTML(project) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protolab 原型</title><style>
html,body{margin:0;min-height:100%;background:#f1f5f9}body{display:grid;place-items:start center;padding:32px;box-sizing:border-box}
${PROTOTYPE_CSS}
.prototype{width:${project.canvas.width}px;height:${project.canvas.height}px;border-radius:16px;box-shadow:0 20px 35px -8px rgba(0,0,0,.15);flex-shrink:0}
@media(max-width:${project.canvas.width + 64}px){body{padding:0;display:block}.prototype{border-radius:0}}
</style></head><body><main class="prototype" aria-label="原型画布">${project.items.map(itemHTML).join('\n')}</main></body></html>`;
}
