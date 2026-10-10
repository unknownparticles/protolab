import { normalizeFrame, frameLayout, cameraLayout } from './frames.js';
import { appearancePresentation, APPEARANCE_CSS } from './appearance.js';
import { orientationPresentation } from './orientation.js';
import { withPages, normalizeInteraction } from './pages.js';
import { PROTOTYPE_RUNTIME, INTERACTION_CSS } from './prototype-runtime.js';
/** 组件只承载静态标记，移除脚本、事件、页面级样式及外部资源。 */
const HTML_TAGS = new Set('div span p strong b em i u s small h1 h2 h3 h4 h5 h6 section article header footer main nav aside ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col label button input textarea select option img a br hr pre code blockquote figure figcaption'.split(' '));
const SVG_TAGS = new Set('svg g path rect circle ellipse line polyline polygon text tspan image defs lineargradient radialgradient stop clippath mask title desc'.split(' '));
const REMOVE = new Set('script style iframe object embed link meta base form foreignobject animate animatetransform set use'.split(' '));
const EDITOR_ATTRIBUTE = 'data-protolab-text';
const ATTRS = new Set('title alt placeholder value type disabled checked selected readonly multiple rows cols maxlength min max step role tabindex width height viewbox fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule d x y x1 x2 y1 y2 cx cy r rx ry points opacity fill-opacity stroke-opacity transform preserveaspectratio offset stop-color stop-opacity gradientunits gradienttransform spreadmethod vector-effect'.split(' '));
export const STYLES = new Set('display position flex flex-direction flex-wrap flex-grow flex-shrink align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row width height min-width min-height max-width max-height top right bottom left margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left background background-color background-image background-size background-position color border border-width border-style border-color border-top border-right border-bottom border-left border-radius box-shadow box-sizing overflow overflow-x overflow-y opacity font-size font-family font-weight font-style line-height letter-spacing text-align text-decoration text-transform white-space word-break object-fit object-position vertical-align cursor appearance list-style-type text-indent text-overflow border-collapse border-spacing'.split(' '));
// CSSOM 将简写展开为长属性，清理时也需要保留这些属性。
for (const side of ['top', 'right', 'bottom', 'left']) for (const value of ['width', 'style', 'color']) STYLES.add(`border-${side}-${value}`);
for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) STYLES.add(`border-${corner}-radius`);
for (const property of ['flex-basis', 'background-repeat', 'background-origin', 'background-clip', 'background-position-x', 'background-position-y', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end']) STYLES.add(property);
STYLES.add('mix-blend-mode');
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
      } else if (['href', 'xlink:href'].includes(name) && tag === 'image' && isImageData(attr.value)) {
        element.setAttribute('href', attr.value);
        if (name === 'xlink:href') element.removeAttribute(attr.name);
      } else if (!ATTRS.has(name) && name !== EDITOR_ATTRIBUTE && !/^aria-[a-z-]+$/.test(name)) {
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
/** SVG 内嵌图片通过 preserveAspectRatio 控制填充，而 HTML 图片使用 object-fit。 */
export function fitSVGImages(content, fit) {
  if (!['fill', 'cover', 'contain'].includes(fit)) return content;
  const aspect = { fill: 'none', cover: 'xMidYMid slice', contain: 'xMidYMid meet' }[fit];
  if (!aspect) return content;
  return content.replace(/<image(?=[\s/>])(?:"[^"]*"|'[^']*'|[^"'<>])*>/gi, tag => {
    // 跳过其他属性的引号内容，避免误改标题等文本。
    const clean = tag.replace(/"[^"]*"|'[^']*'|(\s+preserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))/gi, (match, attribute) => attribute ? '' : match);
    return clean.replace(/\s*\/?\s*>$/, ` preserveAspectRatio="${aspect}"${/\/\s*>$/.test(tag) ? '/>' : '>'}`);
  });
}
/** 编辑、预览和导出共用结构，确保尺寸、边距及零圆角一致。 */
export function itemHTML(item, canvas) {
  const appearance = appearancePresentation(item.appearance);
  const inner = item.type === 'image' ? `<img src="${escapeHTML(item.content)}" alt="${escapeHTML(item.name)}" style="width:100%;height:100%;object-fit:contain">` : fitSVGImages(item.content, item.appearance?.imageFit);
  const { hidden, angle } = orientationPresentation(item, canvas);
  const action = normalizeInteraction(item.interaction);
  const interaction = action ? ` data-action="${escapeHTML(action.type)}"${action.targetId ? ` data-target="${escapeHTML(action.targetId)}"` : ''} role="button" tabindex="0" aria-label="${escapeHTML(item.name)}"` : '';
  return `<div class="prototype-item${item.type === 'svg' ? ' vector-item' : ''}${item.imported ? ' imported-item' : ''}${appearance.classes ? ` ${appearance.classes}` : ''}" data-name="${escapeHTML(item.name)}"${interaction} style="left:${item.x}px;top:${item.y}px;width:${item.width}px;height:${item.height}px;border-radius:${item.radius}px;padding:${escapeHTML(item.padding)}${appearance.style ? `;${escapeHTML(appearance.style)}` : ''}${hidden ? ';display:none' : ''}${angle ? `;transform:rotate(${angle}deg)` : ''}"><div class="prototype-content" style="margin:${escapeHTML(item.margin)}">${inner}</div></div>`;
}
export const PROTOTYPE_CSS = `
${APPEARANCE_CSS}
.prototype{position:relative;background:#fff;overflow:hidden;color:#0f172a;font-family:Inter,system-ui,-apple-system,sans-serif}
.prototype-item{position:absolute;box-sizing:border-box;display:flex;align-items:stretch;overflow:hidden;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.06);isolation:isolate}
.prototype-content{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:inherit}
.prototype-content *{box-sizing:border-box;font-family:inherit}
.prototype-content p,.prototype-content h1,.prototype-content h2,.prototype-content h3{margin:0}
.prototype-content input,.prototype-content textarea,.prototype-content button{font-family:inherit}
.prototype-item.vector-item{background:transparent;box-shadow:none}
.prototype-item.imported-item{background:transparent;box-shadow:none;overflow:visible}
.imported-item>.prototype-content{display:block;overflow:visible}
.device-shell{position:relative;flex-shrink:0;isolation:isolate;font-family:system-ui,-apple-system,sans-serif}
.device-decoration{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;border-radius:32px}
.device-screen{position:absolute;z-index:1;isolation:isolate}
.device-screen>.prototype{width:100%;height:100%;border-radius:0;box-shadow:none}
.device-shell.phone-modern,.device-shell.phone-classic,.device-shell.tablet-modern,.device-shell.tablet-classic{background:#18202c;border:0;border-radius:32px;box-shadow:0 18px 40px #0f172a30,0 0 0 2px #64748b}
.phone-modern .device-screen{border-radius:22px;overflow:hidden}.tablet-modern .device-screen{border-radius:12px;overflow:hidden}
.phone-classic .device-screen,.tablet-classic .device-screen{border-radius:3px;overflow:hidden}
.device-hardware{position:absolute;inset:0;pointer-events:none}
.device-camera{position:absolute;top:5px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#607590}
.device-cutout{position:absolute;z-index:4;background:#11151e;pointer-events:auto;cursor:default;border-radius:999px;box-shadow:inset 0 0 0 1px #273244}
.device-cutout.notch{border-radius:0 0 15px 15px}.device-cutout.notch.landscape{border-radius:0 15px 15px 0}
.device-cutout i{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:#1b3555;box-shadow:inset 0 0 0 2px #243d59}
.device-cutout.landscape i{right:50%;top:auto;bottom:8px;transform:translateX(50%)}
.device-cutout.punch-center i,.device-cutout.punch-left i{right:50%;top:50%;bottom:auto;transform:translate(50%,-50%);width:6px;height:6px}
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
  const frame = normalizeFrame(rawFrame, rawFrame?.device || canvas.preset);
  const layout = frameLayout(canvas, frame);
  const key = `${frame.device}-${frame.style}`;
  const camera = cameraLayout(canvas, frame);
  const cutout = camera ? `<div class="device-cutout ${camera.kind}${camera.landscape ? ' landscape' : ''}" style="left:${camera.left}px;top:${camera.top}px;width:${camera.width}px;height:${camera.height}px" aria-hidden="true"><i></i></div>` : '';
  let decoration = '';
  if (frame.style === 'custom') decoration = frame.html;
  else if (frame.style !== 'none') {
    decoration = '<div class="device-hardware">';
    if (frame.device === 'tablet' || frame.style === 'classic' || frame.style === 'laptop') decoration += '<span class="device-camera"></span>';
    if (frame.style === 'classic') decoration += '<span class="device-home"></span>';
    if (frame.style === 'monitor') decoration += '<span class="device-stand"></span>';
    if (frame.style === 'laptop') decoration += '<span class="device-trackpad"></span>';
    if (frame.style === 'browser') decoration += '<div class="device-browser-bar"><i></i><i></i><i></i><span>原型预览</span></div>';
    decoration += '</div>';
  }
  const mobile = frame.device !== 'pc';
  const status = mobile && frame.statusBar ? `<div class="device-status" style="height:${camera?.statusHeight || 28}px;padding-left:${camera?.statusPaddingLeft || 16}px" aria-label="顶部时间电量栏"><span>${frame.time}</span><span class="device-indicators"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 14h2v-3H1zm4 0h2V8H5zm4 0h2V5H9zm4 0h2V2h-2z"/></svg><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 6a11 11 0 0 1 14 0M4 9a6 6 0 0 1 8 0M6 12a3 3 0 0 1 4 0"/></svg><span>${frame.battery}%</span><span class="device-battery"><i style="width:${frame.battery}%"></i></span></span></div>` : '';
  const navigation = mobile && frame.navigation !== 'none' ? `<div class="device-navigation ${frame.navigation}" aria-label="底部导航栏">${frame.navigation === 'gesture' ? '<span class="device-gesture"></span>' : '<span class="device-nav-back"></span><span class="device-nav-home"></span><span class="device-nav-recent"></span>'}</div>` : '';
  return { layout, className: `device-shell ${key}`, style: `width:${layout.width}px;height:${layout.height}px`, inner: `<div class="device-decoration" aria-hidden="true">${decoration}</div><div class="device-screen" style="left:${layout.left}px;top:${layout.top}px;width:${canvas.width}px;height:${canvas.height}px">${screenHTML}${status}${navigation}${cutout}</div>` };
}
export function exportHTML(value, { preview = false } = {}) {
  const project = withPages(value);
  const active = project.pages.find(page => page.id === project.activePageId);
  const startId = preview && active.kind === 'page' ? active.id : project.startPageId;
  const normalPages = project.pages.filter(page => page.kind === 'page');
  const markup = page => {
    const screen = `<main class="prototype" style="background-color:${escapeHTML(page.canvas.background || '#fff')}" aria-label="原型画布">${page.items.map(item => itemHTML(item, page.canvas)).join('\n')}</main>`;
    const device = deviceMarkup(page.canvas, page.frame, screen);
    return `<div class="${device.className}" style="${device.style}">${device.inner}</div>`;
  };
  const controls = normalPages.length > 1 ? '<nav class="prototype-controls" aria-label="原型导航"><button id="prototypeBack" disabled>返回</button><span id="prototypePageName"></span><button id="prototypeRestart">回到首页</button></nav>' : '';
  const pages = normalPages.map(page => `<section class="prototype-page" data-prototype-page="${escapeHTML(page.id)}" data-page-name="${escapeHTML(page.name)}" tabindex="-1"${page.id !== startId ? ' hidden inert' : ''}>${markup(page)}</section>`).join('\n');
  const popups = project.pages.filter(page => page.kind === 'popup').map(page => `<dialog class="prototype-popup" data-prototype-popup="${escapeHTML(page.id)}" aria-label="${escapeHTML(page.name)}"><div class="prototype-popup-heading"><h2>${escapeHTML(page.name)}</h2><button data-action="closePopup" aria-label="关闭弹窗">关闭 ×</button></div>${markup(page)}</dialog>`).join('\n');
  const maxWidth = Math.max(...normalPages.map(page => frameLayout(page.canvas, page.frame).width));
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protolab 原型</title><style>
html,body{margin:0;min-height:100%;background:#f1f5f9}body{display:flex;flex-direction:column;align-items:center;padding:32px;box-sizing:border-box}
${PROTOTYPE_CSS}
${INTERACTION_CSS}
@media(max-width:${maxWidth + 64}px){body{padding:0;align-items:flex-start}}
</style></head><body data-start-page="${escapeHTML(startId)}"${preview && active.kind === 'popup' ? ` data-initial-popup="${escapeHTML(active.id)}"` : ''}>${controls}${pages}${popups}<script type="application/json" id="protolab-project">${JSON.stringify(value.pages ? project : value).replace(/</g, '\\u003c')}</script><script>${PROTOTYPE_RUNTIME}</script></body></html>`;
}
