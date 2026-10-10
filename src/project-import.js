import { MAX_ITEMS, MAX_CODE, uid, validateProject, validateLibrary } from './model.js';
import { sanitizeContent, STYLES } from './content.js';

export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export function projectFile(project, library) {
  const value = { format: 'protolab-project', version: 1, project, components: library.filter(item => !item.builtin) };
  const json = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_PROJECT_BYTES) throw new Error('工程文件不能超过 32 MB');
  return json;
}
export function parseProjectJSON(raw) {
  if (raw?.format === 'protolab-project') {
    if (raw.version !== 1) throw new Error('不支持此工程版本');
    return { project: validateProject(raw.project, sanitizeContent), components: validateLibrary(raw.components, sanitizeContent), warnings: [] };
  }
  return { project: validateProject(raw, sanitizeContent), warnings: [] };
}

// 样式在隔离文档内计算，保留选择器、变量、媒体查询及布局，禁止加载资源。
function cleanDeclaration(style) {
  for (const name of [...style]) {
    const value = style.getPropertyValue(name);
    if (/(?:url\s*\(|image-set\s*\(|expression\s*\(|@|\\)/i.test(value)) style.removeProperty(name);
  }
}
function cleanCSS(css) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rules = values => [...values].map(rule => {
    if (rule.type === CSSRule.STYLE_RULE) { cleanDeclaration(rule.style); return rule.cssText; }
    if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${rules(rule.cssRules)}}`;
    return '';
  }).join('\n');
  return rules(sheet.cssRules);
}
function prepareDocument(doc, warnings) {
  const blocked = doc.querySelectorAll('script,iframe,object,embed,link,meta,base,audio,video,source,foreignObject,animate,animateTransform,set,use');
  if (blocked.length) warnings.add('脚本、外链资源及活动内容已移除');
  blocked.forEach(element => element.remove());
  for (const style of doc.querySelectorAll('style')) style.textContent = cleanCSS(style.textContent);
  for (const element of doc.querySelectorAll('*')) {
    cleanDeclaration(element.style);
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ['href', 'srcset', 'action', 'formaction', 'poster', 'autofocus'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.hasAttribute('src') && !/^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(element.getAttribute('src'))) {
      element.removeAttribute('src'); warnings.add('外链图片未载入，请使用内嵌图片');
    }
  }
  doc.querySelectorAll('form').forEach(form => { const div = doc.createElement('div'); for (const attr of form.attributes) div.setAttribute(attr.name, attr.value); div.append(...form.childNodes); form.replaceWith(div); });
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";
  doc.head.prepend(policy);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
const atomic = new Set(['button', 'input', 'textarea', 'select', 'svg', 'img']);
const labels = { button: '按钮', input: '输入框', textarea: '多行输入框', select: '下拉选择', svg: '矢量图形', img: '图片', a: '链接', h1: '标题', h2: '标题', h3: '标题', p: '文本', label: '标签' };
const layoutProperties = new Set(['position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'flex-grow', 'flex-shrink', 'align-self', 'grid-column', 'grid-row']);
function snapshot(element, view, deep = false) {
  const copy = ['body', 'html'].includes(element.localName) ? element.ownerDocument.createElement('div') : element.cloneNode(false);
  const computed = view.getComputedStyle(element);
  copy.removeAttribute('id'); copy.removeAttribute('class'); copy.removeAttribute('style');
  for (const name of STYLES) if (!layoutProperties.has(name)) copy.style.setProperty(name, computed.getPropertyValue(name));
  Object.assign(copy.style, { position: 'relative', width: '100%', height: '100%', minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none', margin: '0', boxSizing: 'border-box' });
  if (['inline', 'contents'].includes(computed.display)) copy.style.display = 'block';
  for (const node of element.childNodes) {
    if (node.nodeType === 3 || node.nodeName === 'BR') copy.append(node.cloneNode(true));
    else if (deep && node.nodeType === 1) {
      // SVG geometry remains in its own coordinate system; HTML descendants keep computed styles.
      if (element.namespaceURI === 'http://www.w3.org/2000/svg') copy.append(node.cloneNode(true));
      else {
        const child = snapshot(node, view, true);
        child.style.width = view.getComputedStyle(node).width;
        child.style.height = view.getComputedStyle(node).height;
        copy.append(child);
      }
    }
  }
  if (element.localName === 'input') { copy.setAttribute('value', element.value); if (element.checked) copy.setAttribute('checked', ''); }
  if (element.localName === 'textarea') copy.textContent = element.value;
  return copy;
}
function hasDecoration(style) {
  return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' || style.boxShadow !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && !['none', 'hidden'].includes(style[`border${side}Style`]));
}

export async function importHTML(source, { width = 1280, height = 800 } = {}) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const metadata = parsed.querySelector('script#protolab-project[type="application/json"]');
  if (metadata) return parseProjectJSON(JSON.parse(metadata.textContent));
  const warnings = new Set();
  const html = prepareDocument(parsed, warnings);
  const frame = document.createElement('iframe');
  frame.title = '工程布局识别'; frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none`;
  try {
    const loaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('HTML 布局识别超时')), 10000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      frame.srcdoc = html; document.body.append(frame);
    });
    await loaded;
    const doc = frame.contentDocument, view = frame.contentWindow;
    await Promise.all([...doc.images].map(image => image.decode().catch(() => {})));
    if (doc.querySelectorAll('*').length > 10000) throw new Error('HTML 节点过多，最多支持 10000 个节点');
    const root = doc.querySelector('main.prototype') || doc.body;
    const origin = root === doc.body ? { left: 0, top: 0 } : root.getBoundingClientRect();
    const boxes = [...root.querySelectorAll('*')].map(element => element.getBoundingClientRect());
    const canvasWidth = Math.ceil(Math.max(root === doc.body ? width : origin.width, ...boxes.map(box => box.right - origin.left)));
    const canvasHeight = Math.ceil(Math.max(root === doc.body ? height : origin.height, root.scrollHeight, ...boxes.map(box => box.bottom - origin.top)));
    if (canvasWidth > 2000 || canvasHeight > 2000) throw new Error(`HTML 布局为 ${canvasWidth} × ${canvasHeight}，超过 2000 px 画布限制，请调整导入尺寸或源文件`);
    const items = [];
    const add = (element, box, content, name) => {
      if (!content.trim()) return;
      if (items.length >= MAX_ITEMS) throw new Error('识别出的组件超过 200 个，请拆分工程后导入');
      if (content.length > MAX_CODE) throw new Error('识别出的单个组件内容过大，请拆分后导入');
      if (box.left < origin.left - 1 || box.top < origin.top - 1) warnings.add('画布外的负坐标内容已约束到画布边界');
      items.push({ id: uid(), name, type: element.localName === 'svg' ? 'svg' : 'html', imported: true, content, x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height, radius: 0, padding: '0', margin: '0' });
    };
    const visit = element => {
      const style = view.getComputedStyle(element), box = element.getBoundingClientRect();
      if (style.display === 'none' || parseFloat(style.opacity) === 0) return;
      const children = [...element.children].filter(child => !['style', 'br'].includes(child.localName));
      const isAtomic = atomic.has(element.localName);
      if (box.width > 0 && box.height > 0 && style.visibility !== 'hidden') {
        const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
        const name = (element.getAttribute('aria-label') || element.getAttribute('title') || `${labels[element.localName] || '容器'}${text ? ` · ${text}` : ''}`).slice(0, 80);
        if (isAtomic || hasDecoration(style) || text) {
          const copy = snapshot(element, view, isAtomic);
          const textItems = [];
          if (children.length && !isAtomic && text) {
            // 混合文本通过 Range 保留在行内布局中的实际位置。
            for (const node of [...copy.childNodes]) if (node.nodeType === 3) node.remove();
            for (const node of element.childNodes) if (node.nodeType === 3 && node.textContent.trim()) {
              const range = doc.createRange(); range.selectNodeContents(node);
              const textBox = range.getBoundingClientRect();
              const span = doc.createElement('span');
              for (const property of ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'white-space']) span.style.setProperty(property, style.getPropertyValue(property));
              Object.assign(span.style, { display: 'block', whiteSpace: 'pre-wrap', lineHeight: `${textBox.height}px` });
              span.textContent = node.textContent;
              textItems.push([element, textBox, sanitizeContent(span.outerHTML), `文本 · ${node.textContent.trim().slice(0, 60)}`]);
            }
          }
          if (isAtomic || !children.length || hasDecoration(style)) add(element, box, sanitizeContent(copy.outerHTML, element.localName === 'svg' ? 'svg' : 'html'), name);
          textItems.forEach(args => add(...args));
        }
      }
      if (!isAtomic) children.forEach(visit);
    };
    // 旧版导出按画布识别；普通页面保留 body 的内边距与背景装饰。
    visit(root);
    if (!items.length) throw new Error('HTML 中没有可识别的可见组件');
    const background = view.getComputedStyle(doc.body).backgroundColor;
    const project = validateProject({ version: 1, canvas: { width: Math.max(100, canvasWidth), height: Math.max(100, canvasHeight), preset: 'custom', background: background === 'rgba(0, 0, 0, 0)' ? '#fff' : background }, frame: { device: 'pc', style: 'none', statusBar: false, navigation: 'none' }, items }, sanitizeContent);
    return { project, warnings: [...warnings] };
  } finally { frame.remove(); }
}
export async function importProjectFile(file, options, readFile) {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('工程文件不能超过 32 MB');
  const source = await readFile(file);
  if (/^\s*[\[{]/.test(source) || /\.json$/i.test(file.name)) return parseProjectJSON(JSON.parse(source));
  return importHTML(source, options);
}
