import { normalizeFrame, frameLayout } from './frames.js';
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
  return `<div class="prototype-item${item.type === 'svg' ? ' vector-item' : ''}" data-name="${escapeHTML(item.name)}" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px;border-radius:${item.radius}px;padding:${escapeHTML(item.padding)}"><div class="prototype-content" style="margin:${escapeHTML(item.margin)}">${inner}</div></div>`;
}
export const PROTOTYPE_CSS = `
.prototype{position:relative;background:#fff;overflow:hidden;color:#0f172a;font-family:Inter,system-ui,-apple-system,sans-serif}
.prototype-item{position:absolute;box-sizing:border-box;display:flex;align-items:stretch;overflow:hidden;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.06);isolation:isolate}
.prototype-content{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:inherit}
.prototype-content *{box-sizing:border-box;font-family:inherit}
.prototype-content p,.prototype-content h1,.prototype-content h2,.prototype-content h3{margin:0}
.prototype-content input,.prototype-content textarea,.prototype-content button{font-family:inherit}
.prototype-item.vector-item{background:transparent;box-shadow:none}
.device-shell{position:relative;flex-shrink:0;isolation:isolate;font-family:system-ui,-apple-system,sans-serif}
.device-decoration{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;border-radius:32px}
.device-screen{position:absolute;z-index:1;isolation:isolate}
.device-screen>.prototype{width:100%;height:100%;border-radius:0;box-shadow:none}
.device-shell.phone-modern,.device-shell.phone-classic,.device-shell.tablet-modern,.device-shell.tablet-classic{background:#18202c;border:0;border-radius:32px;box-shadow:0 18px 40px #0f172a30,0 0 0 2px #64748b}
.phone-modern .device-screen{border-radius:22px;overflow:hidden}.tablet-modern .device-screen{border-radius:12px;overflow:hidden}
.phone-classic .device-screen,.tablet-classic .device-screen{border-radius:3px;overflow:hidden}
.device-hardware{position:absolute;inset:0;pointer-events:none}
.device-camera{position:absolute;top:5px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#607590}
.phone-classic .device-camera,.tablet-classic .device-camera{top:23px;width:42px;height:5px;border-radius:4px}
.device-home{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);width:30px;height:30px;border:2px solid #64748b;border-radius:50%}
.pc-monitor .device-decoration{background:linear-gradient(#273244 0 calc(100% - 85px),transparent calc(100% - 85px));border-radius:14px}
.device-stand{position:absolute;bottom:0;left:30%;width:40%;height:85px;background:#94a3b8;clip-path:polygon(42% 0,58% 0,62% 78%,100% 88%,100% 100%,0 100%,0 88%,38% 78%)}
.pc-laptop .device-decoration{background:linear-gradient(#273244 0 calc(100% - 28px),#cbd5e1 calc(100% - 28px));border-radius:14px 14px 20px 20px}
.device-trackpad{position:absolute;bottom:17px;left:42%;width:16%;height:10px;background:#94a3b8;border-radius:0 0 6px 6px}
.pc-browser{background:#e2e8f0;border-radius:10px;box-shadow:0 18px 40px #0f172a20;overflow:hidden}
.device-browser-bar{height:40px;display:flex;align-items:center;gap:6px;padding:0 14px;box-sizing:border-box}
.device-browser-bar i{width:9px;height:9px;border-radius:50%;background:#fb7185}.device-browser-bar i:nth-child(2){background:#fbbf24}.device-browser-bar i:nth-child(3){background:#34d399}
.device-browser-bar span{margin:auto;width:55%;text-align:center;font-size:11px;background:#f8fafc;border-radius:4px;padding:4px;color:#64748b}
.device-status,.device-navigation{position:absolute;left:0;right:0;z-index:3;pointer-events:none;box-sizing:border-box;background:#ffffffed;color:#0f172a}
.device-status{top:0;height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:12px;font-weight:600;gap:8px}
.device-indicators{display:flex;align-items:center;gap:6px;white-space:nowrap}.device-indicators svg{width:14px;height:14px}
.device-battery{width:22px;height:10px;border:1px solid currentColor;border-radius:3px;padding:1px;box-sizing:border-box;position:relative}.device-battery:after{content:'';position:absolute;right:-3px;top:2px;width:2px;height:4px;background:currentColor}.device-battery i{display:block;height:100%;background:currentColor;border-radius:1px}
.device-navigation{bottom:0;height:28px;display:flex;justify-content:center;align-items:center;gap:60px}
.device-gesture{width:100px;max-width:50%;height:4px;border-radius:4px;background:currentColor}
.device-navigation.buttons{height:40px;gap:0;justify-content:space-around}.device-nav-back{width:10px;height:10px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg)}.device-nav-home{width:12px;height:12px;border:2px solid currentColor;border-radius:50%}.device-nav-recent{width:12px;height:12px;border:2px solid currentColor}
`;
export function deviceMarkup(canvas, rawFrame, screenHTML = '') {
  const frame = normalizeFrame(rawFrame, canvas.preset);
  const layout = frameLayout(canvas, frame);
  const key = `${frame.device}-${frame.style}`;
  let decoration = '';
  if (frame.style === 'custom') decoration = frame.html;
  else if (frame.style !== 'none') {
    decoration = '<div class="device-hardware">';
    if (frame.device !== 'pc' || frame.style === 'laptop') decoration += '<span class="device-camera"></span>';
    if (frame.style === 'classic') decoration += '<span class="device-home"></span>';
    if (frame.style === 'monitor') decoration += '<span class="device-stand"></span>';
    if (frame.style === 'laptop') decoration += '<span class="device-trackpad"></span>';
    if (frame.style === 'browser') decoration += '<div class="device-browser-bar"><i></i><i></i><i></i><span>原型预览</span></div>';
    decoration += '</div>';
  }
  const mobile = frame.device !== 'pc';
  const status = mobile && frame.statusBar ? `<div class="device-status" aria-label="顶部时间电量栏"><span>${frame.time}</span><span class="device-indicators"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 14h2v-3H1zm4 0h2V8H5zm4 0h2V5H9zm4 0h2V2h-2z"/></svg><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 6a11 11 0 0 1 14 0M4 9a6 6 0 0 1 8 0M6 12a3 3 0 0 1 4 0"/></svg><span>${frame.battery}%</span><span class="device-battery"><i style="width:${frame.battery}%"></i></span></span></div>` : '';
  const navigation = mobile && frame.navigation !== 'none' ? `<div class="device-navigation ${frame.navigation}" aria-label="底部导航栏">${frame.navigation === 'gesture' ? '<span class="device-gesture"></span>' : '<span class="device-nav-back"></span><span class="device-nav-home"></span><span class="device-nav-recent"></span>'}</div>` : '';
  return { layout, className: `device-shell ${key}`, style: `width:${layout.width}px;height:${layout.height}px`, inner: `<div class="device-decoration" aria-hidden="true">${decoration}</div><div class="device-screen" style="left:${layout.left}px;top:${layout.top}px;width:${canvas.width}px;height:${canvas.height}px">${screenHTML}${status}${navigation}</div>` };
}
export function exportHTML(project) {
  const screen = `<main class="prototype" aria-label="原型画布">${project.items.map(itemHTML).join('\n')}</main>`;
  const device = deviceMarkup(project.canvas, project.frame, screen);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protolab 原型</title><style>
html,body{margin:0;min-height:100%;background:#f1f5f9}body{display:grid;place-items:start center;padding:32px;box-sizing:border-box}
${PROTOTYPE_CSS}
@media(max-width:${device.layout.width + 64}px){body{padding:0;display:block}}
</style></head><body><div class="${device.className}" style="${device.style}">${device.inner}</div></body></html>`;
}
