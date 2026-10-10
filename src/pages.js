import { normalizeFrame } from './frames.js';
/** 顶层画布是当前页面的编辑视图；保存时同步到页面集合。 */
export const MAX_PAGES = 30;
export const INTERACTIONS = Object.freeze({ none: '无动作', navigate: '跳转页面', back: '返回上一页', openPopup: '打开弹窗', closePopup: '关闭弹窗' });
const copy = value => structuredClone(value);
export const pageBoard = value => copy({ canvas: value.canvas, frame: value.frame, safeArea: value.safeArea, items: value.items });
export function syncPages(project) {
  if (!project.pages) return project;
  return { ...project, pages: project.pages.map(page => page.id === project.activePageId ? { ...page, ...pageBoard(project) } : page) };
}
export function withPages(project) {
  if (project.pages) return syncPages(project);
  return { ...project, activePageId: 'page-home', startPageId: 'page-home',
    pages: [{ id: 'page-home', name: '首页', kind: 'page', ...pageBoard(project) }] };
}
export function activePage(project) { return project.pages?.find(page => page.id === project.activePageId); }
export function switchPage(project, id) {
  const next = withPages(project);
  const page = next.pages.find(page => page.id === id);
  if (!page) throw new Error('页面不存在');
  return { ...next, ...pageBoard(page), activePageId: id };
}
export function addPage(project, kind = 'page', duplicate = false) {
  const next = withPages(project);
  if (next.pages.length >= MAX_PAGES) throw new Error('页面与弹窗合计最多 30 个');
  const source = activePage(next);
  const id = globalThis.crypto.randomUUID();
  const board = pageBoard(source);
  const page = { id, kind: duplicate ? source.kind : kind,
    name: duplicate ? `${source.name.slice(0, 35)} 副本` : `${kind === 'popup' ? '弹窗' : '页面'} ${next.pages.filter(page => page.kind === kind).length + 1}`, ...board };
  if (duplicate) page.items = page.items.map(item => ({ ...item, id: globalThis.crypto.randomUUID() }));
  else {
    page.items = [];
    if (kind === 'popup') {
      page.canvas = { width: 320, height: 240, preset: 'custom' };
      page.frame = normalizeFrame({ device: 'pc', style: 'none' }, 'custom');
      page.safeArea = { enabled: false, top: 0, right: 0, bottom: 0, left: 0 };
    }
  }
  next.pages = [...next.pages, page];
  return switchPage(next, id);
}
export function deletePage(project, id) {
  let next = withPages(project);
  const removed = next.pages.find(page => page.id === id);
  if (!removed) throw new Error('页面不存在');
  if (removed.kind === 'page' && next.pages.filter(page => page.kind === 'page').length === 1) throw new Error('至少保留一个普通页面');
  next.pages = next.pages.filter(page => page.id !== id).map(page => ({ ...page, items: page.items.map(item => {
    if (item.interaction?.targetId !== id) return item;
    const cleaned = { ...item }; delete cleaned.interaction; return cleaned;
  }) }));
  if (next.startPageId === id) next.startPageId = next.pages.find(page => page.kind === 'page').id;
  // 先恢复清理后的视图，避免旧的顶层组件写回页面集合。
  const target = next.pages.find(page => page.id === next.activePageId) || next.pages.find(page => page.id === next.startPageId);
  next = { ...next, ...pageBoard(target), activePageId: target.id };
  return next;
}
export function normalizeInteraction(raw) {
  if (raw == null || raw.type === 'none') return undefined;
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(INTERACTIONS, raw.type)) throw new Error('组件点击动作不正确');
  if (['navigate', 'openPopup'].includes(raw.type)) {
    if (typeof raw.targetId !== 'string' || !raw.targetId || raw.targetId.length > 100) throw new Error('请选择点击动作的目标');
    return { type: raw.type, targetId: raw.targetId };
  }
  return { type: raw.type };
}
export function validatePageLinks(project) {
  for (const page of project.pages || [project]) for (const item of page.items) {
    const action = item.interaction;
    if (!action || !['navigate', 'openPopup'].includes(action.type)) continue;
    const target = project.pages?.find(page => page.id === action.targetId);
    if (!target || target.kind !== (action.type === 'navigate' ? 'page' : 'popup')) throw new Error('组件点击动作的目标不存在或类型不匹配');
  }
}
