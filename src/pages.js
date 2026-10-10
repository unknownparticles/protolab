import { normalizeFrame } from './frames.js';
/** 顶层画布是当前页面的编辑视图；保存时同步到页面集合。 */
export const MAX_PAGES = 30;
export const PAGE_KINDS = Object.freeze({ page: '页面', popup: '弹窗', toast: 'Toast' });
export const INTERACTIONS = Object.freeze({ none: '无动作', navigate: '跳转至页面', back: '返回上一页', openPopup: '跳转出弹窗', closePopup: '关闭弹窗', showToast: '显示 Toast', visibility: '设置元素显示 / 隐藏' });
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
  if (!Object.hasOwn(PAGE_KINDS, kind)) throw new Error('不支持的页面类型');
  const next = withPages(project);
  if (next.pages.length >= MAX_PAGES) throw new Error('页面与弹窗合计最多 30 个');
  const source = activePage(next);
  const id = globalThis.crypto.randomUUID();
  const board = pageBoard(source);
  const page = { id, kind: duplicate ? source.kind : kind,
    name: duplicate ? `${source.name.slice(0, 35)} 副本` : `${PAGE_KINDS[kind]} ${next.pages.filter(page => page.kind === kind).length + 1}`, ...board };
  if (duplicate) page.items = copyItems(page.items);
  else {
    page.items = [];
    if (kind !== 'page') {
      page.canvas = { width: 320, height: kind === 'toast' ? 100 : 240, preset: 'custom' };
      page.frame = normalizeFrame({ device: 'pc', style: 'none' }, 'custom');
      page.safeArea = { enabled: false, top: 0, right: 0, bottom: 0, left: 0 };
      if (kind === 'toast') page.items = [{ id: globalThis.crypto.randomUUID(), name: '提示文案', type: 'html', content: '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1e293b;color:#fff">操作成功</div>', x: 0, y: 0, width: 320, height: 100, radius: 12, padding: '0', margin: '0' }];
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
  if (['navigate', 'openPopup', 'showToast'].includes(raw.type)) {
    if (typeof raw.targetId !== 'string' || !raw.targetId || raw.targetId.length > 100) throw new Error('请选择点击动作的目标');
    if (raw.type === 'showToast') {
      const duration = raw.duration == null ? 2500 : Number(raw.duration);
      if (!Number.isInteger(duration) || duration < 200 || duration > 10000) throw new Error('提示时长须为 200～10000 毫秒');
      return { type: raw.type, targetId: raw.targetId, duration };
    }
    return { type: raw.type, targetId: raw.targetId };
  }
  if (raw.type === 'visibility') {
    if (!Array.isArray(raw.targetIds) || !raw.targetIds.length || raw.targetIds.length > 200 || raw.targetIds.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Error('请选择要显示或隐藏的元素');
    if (!['show', 'hide', 'toggle'].includes(raw.mode)) throw new Error('元素显隐方式不正确');
    return { type: raw.type, targetIds: [...new Set(raw.targetIds)], mode: raw.mode };
  }
  return { type: raw.type };
}
export function validatePageLinks(project) {
  for (const page of project.pages || [project]) for (const item of page.items) {
    const action = item.interaction;
    if (action?.type === 'visibility') {
      if (action.targetIds.some(id => !page.items.some(value => value.id === id))) throw new Error('元素显隐动作的目标不存在于当前页面');
      continue;
    }
    if (!action || !['navigate', 'openPopup', 'showToast'].includes(action.type)) continue;
    const target = project.pages?.find(page => page.id === action.targetId);
    if (!target || target.kind !== ({ navigate: 'page', openPopup: 'popup', showToast: 'toast' }[action.type])) throw new Error('组件点击动作的目标不存在或类型不匹配');
  }
}

/** 复制整组时显隐关联指向副本；单独复制触发器仍控制原目标。 */
export function copyItems(items) {
  const ids = new Map(items.map(item => [item.id, globalThis.crypto.randomUUID()]));
  return items.map(item => {
    const value = { ...copy(item), id: ids.get(item.id) };
    if (value.interaction?.type === 'visibility') value.interaction.targetIds = value.interaction.targetIds.map(id => ids.get(id) || id);
    return value;
  });
}
export function cleanVisibilityTargets(items) {
  const ids = new Set(items.map(item => item.id));
  return items.map(item => {
    if (item.interaction?.type !== 'visibility') return item;
    const targetIds = item.interaction.targetIds.filter(id => ids.has(id));
    const value = { ...item };
    if (targetIds.length) value.interaction = { ...item.interaction, targetIds };
    else delete value.interaction;
    return value;
  });
}
