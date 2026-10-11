import { EN } from './locales.js';

export const LANGUAGE_KEY = 'protolab.language';
export const LANGUAGE_OPTIONS = Object.freeze(['system', 'zh', 'en']);
export function resolveLocale(preference = 'system', languages = []) {
  if (preference === 'zh' || preference === 'en') return preference;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}
const systemLanguages = () => globalThis.navigator?.languages?.length ? [...navigator.languages] : [globalThis.navigator?.language || 'zh-CN'];
let preference = 'system';
try { const saved = globalThis.localStorage?.getItem(LANGUAGE_KEY); if (LANGUAGE_OPTIONS.includes(saved)) preference = saved; } catch { /* 禁用存储仍可切换。 */ }
let locale = resolveLocale(preference, systemLanguages());
export const getLocale = () => locale === 'zh' ? 'zh-CN' : 'en';
export const getLanguagePreference = () => preference;

const patternEntries = Object.entries(EN).filter(([key]) => /\{\d+\}/.test(key));
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pattern(value) {
  const indexes = [];
  let offset = 0, source = '';
  for (const match of value.matchAll(/\{(\d+)\}/g)) {
    source += escapePattern(value.slice(offset, match.index)) + '([\\s\\S]*?)';
    indexes.push(Number(match[1])); offset = match.index + match[0].length;
  }
  return { regex: new RegExp(`^${source}${escapePattern(value.slice(offset))}$`), indexes };
}
const patterns = patternEntries.map(([zh, en]) => ({ zh, en, chinese: pattern(zh), english: pattern(en) }));
const reverse = new Map(Object.entries(EN).map(([zh, en]) => [en, zh]));
const format = (source, values) => source.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match);
export function translate(source, values = [], language = locale) {
  return format(language === 'en' ? EN[source] ?? source : source, values);
}
/** 标签模板只翻译固定文案，插值中的工程名、组件名和内容原样显示。 */
export function t(source, ...values) {
  if (Array.isArray(source) && Object.hasOwn(source, 'raw')) {
    const key = source.reduce((result, part, index) => result + (index ? `{${index - 1}}` : '') + part, '');
    return translate(key, values);
  }
  source = String(source);
  if (Object.hasOwn(EN, source)) return translate(source);
  if (reverse.has(source)) return translate(reverse.get(source));
  for (const entry of patterns) {
    const match = entry.chinese.regex.exec(source);
    if (match) { const args = []; entry.chinese.indexes.forEach((index, position) => { args[index] = match[position + 1]; }); return translate(entry.zh, args); }
    const englishMatch = entry.english.regex.exec(source);
    if (englishMatch) { const args = []; entry.english.indexes.forEach((index, position) => { args[index] = englishMatch[position + 1]; }); return translate(entry.zh, args); }
  }
  return String(source);
}
function retranslate(value, previous) {
  if (previous === 'zh') return t(value);
  if (reverse.has(value)) return translate(reverse.get(value));
  for (const entry of patterns) {
    const match = entry.english.regex.exec(value);
    if (match) { const args = []; entry.english.indexes.forEach((index, position) => { args[index] = match[position + 1]; }); return translate(entry.zh, args); }
  }
  return value;
}

const staticText = new WeakMap();
const staticAttributes = new WeakMap();
/** 绑定初始界面文本节点，保留 HTML、图标、表单值及事件监听器。 */
export function bindStaticTranslations(root) {
  const bindings = [];
  const visit = node => {
    if (node.nodeType === 3 && Object.hasOwn(EN, node.textContent.trim())) {
      const source = node.textContent; let last = source;
      const apply = () => { if (!node.isConnected || node.textContent !== last) return false; last = source.replace(source.trim(), translate(source.trim())); node.textContent = last; return true; };
      staticText.set(node, apply); bindings.push(apply);
    }
    if (node.nodeType === 1) {
      if (node.matches('script, style, [data-i18n-ignore]')) return;
      for (const attribute of ['aria-label', 'title', 'placeholder', 'data-collapse-title', 'content']) {
        const source = node.getAttribute(attribute);
        if (!source || !Object.hasOwn(EN, source)) continue;
        let last = source;
        const apply = () => { if (!node.isConnected || node.getAttribute(attribute) !== last) return false; last = translate(source); node.setAttribute(attribute, last); return true; };
        const attributes = staticAttributes.get(node) || new Map(); attributes.set(attribute, apply); staticAttributes.set(node, attributes); bindings.push(apply);
      }
    }
    if (node.nodeType === 1 && node.localName === 'textarea') return;
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return () => bindings.forEach(apply => apply());
}
const ignored = 'script, style, [data-i18n-ignore], .prototype-content, .device-decoration, .component-preview, .item-label, .component-name, .merge-values pre, .merge-conflict>strong, #projectSelect, #propClickTarget, #propVisibilityTargets, #engineeringManifest, #engineeringLibraryGroups, #layerList, #pageList, #artboardName, #customGroup, #manageComponentGroup, #customGroupFilter, #aiPendingSummary, #aiGeneratedSummary, #generationSummary, #aiMessages span, #aiTarget, #aiLayoutRows, #generationLayoutRows';
function refreshChrome(root, previous) {
  const visit = node => {
    if (node.nodeType === 3 && node.textContent.trim()) {
      if (staticText.get(node)?.()) return;
      const source = node.textContent;
      node.textContent = source.replace(source.trim(), retranslate(source.trim(), previous));
    }
    if (node.nodeType === 1) {
      if (node.matches(ignored)) return;
      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        if (staticAttributes.get(node)?.get(attribute)?.()) continue;
        const source = node.getAttribute(attribute);
        if (source) node.setAttribute(attribute, retranslate(source, previous));
      }
    }
    if (node.nodeType === 1 && node.localName === 'textarea') return;
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
}
export function initializeLanguage({ root = document, refreshStatic, onChange }) {
  const selector = root.getElementById('languageSelect');
  selector.value = preference;
  const updateMetadata = () => {
    root.documentElement.lang = getLocale();
    root.title = t('易设 · 原型设计工具');
    root.querySelector('meta[name="description"]').content = t('易设：拖拽搭建、随时编辑、导出即用的轻量原型设计器。');
  };
  const apply = () => {
    const previous = locale;
    locale = resolveLocale(preference, systemLanguages());
    if (previous !== locale) { refreshChrome(root.body, previous); onChange(); }
    refreshStatic(); updateMetadata();
  };
  selector.addEventListener('change', () => {
    preference = LANGUAGE_OPTIONS.includes(selector.value) ? selector.value : 'system';
    try { localStorage.setItem(LANGUAGE_KEY, preference); } catch { /* 本次会话仍生效。 */ }
    apply();
  });
  globalThis.addEventListener('languagechange', () => { if (preference === 'system') apply(); });
  // 初次只翻译静态文案；动态文案已由 t 按系统语言渲染。
  refreshStatic(); updateMetadata();
}
