import { t } from './i18n.js';
import { INTERACTIONS, PAGE_KINDS, activePage, switchPage, addPage, deletePage, normalizeInteraction } from './pages.js';

const $ = id => document.getElementById(id);

/** 页面列表、页面设置与点击动作表单；工程和历史由入口管理。 */
export function initializePagePanel({ getProject, getSession, selectedItem, applyPageChange, finishGesture, commit, saveProject, notify, safeAction }) {
  function renderInteractionTargets(targetId = $('propClickTarget').value) {
    const type = $('propClickAction').value;
    const needsTarget = ['navigate', 'openPopup', 'showToast'].includes(type);
    $('propClickTargetField').hidden = !needsTarget;
    $('propClickTarget').required = needsTarget;
    $('propClickTarget').disabled = !needsTarget;
    const kind = { navigate: 'page', openPopup: 'popup', showToast: 'toast' }[type];
    const targets = getProject().pages.filter(page => page.kind === kind);
    $('propClickTarget').replaceChildren(new Option(t('请选择目标'), ''), ...targets.map(page => new Option(page.name, page.id)));
    $('propClickTarget').value = targets.some(page => page.id === targetId) ? targetId : '';
    $('propToastDurationField').hidden = type !== 'showToast';
    $('propToastDuration').disabled = type !== 'showToast';
    $('propToastDuration').required = type === 'showToast';
    $('propVisibilityFields').hidden = type !== 'visibility';
    $('propVisibilityMode').disabled = type !== 'visibility';
    const selected = selectedItem()?.interaction?.targetIds || [];
    $('propVisibilityTargets').replaceChildren(...getProject().items.map(item => {
      const label = document.createElement('label'); label.className = 'checkbox-field';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
      input.checked = selected.includes(item.id); input.disabled = type !== 'visibility';
      label.append(input, document.createTextNode(item.name)); return label;
    }));
    $('interactionHelp').textContent = needsTarget && !targets.length ? t`请先在页面管理中新建${t(PAGE_KINDS[kind])}。` : type === 'visibility' ? t('目标限于当前页面；多选元素可以一起展开或收起整个板块。') : t('在预览和导出的 HTML 中点击组件执行动作。');
  }
  function readInteraction() {
    return normalizeInteraction({ type: $('propClickAction').value, targetId: $('propClickTarget').value,
      duration: $('propToastDuration').value, mode: $('propVisibilityMode').value,
      targetIds: [...$('propVisibilityTargets').querySelectorAll('input:checked')].map(input => input.value) });
  }
  $('propClickAction').replaceChildren(...Object.entries(INTERACTIONS).map(([value, label]) => new Option(t(label), value)));
  $('propClickAction').addEventListener('change', () => renderInteractionTargets(''));
  function renderPages() {
    const onlyPage = getProject().pages.filter(page => page.kind === 'page').length === 1;
    $('pageList').replaceChildren(...getProject().pages.map(page => {
      const entry = document.createElement('div'); entry.className = 'page-tab-entry';
      const button = document.createElement('button');
      button.type = 'button'; button.className = `page-tab${page.id === getProject().activePageId ? ' active' : ''}`;
      button.dataset.pageId = page.id; button.setAttribute('aria-pressed', String(page.id === getProject().activePageId));
      button.textContent = `${page.kind !== 'page' ? `${t(PAGE_KINDS[page.kind])} · ` : ''}${page.name}${page.id === getProject().startPageId ? t(' · 首页') : ''}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'page-tab-delete'; remove.dataset.deletePageId = page.id;
      remove.textContent = '×'; remove.setAttribute('aria-label', t`删除「${page.name}」`);
      remove.disabled = page.kind === 'page' && onlyPage;
      remove.title = remove.disabled ? t('至少保留一个普通页面') : t`删除「${page.name}」`;
      entry.append(button, remove); return entry;
    }));
    const page = activePage(getProject());
    $('artboardName').textContent = page.name;
    $('pageSummary').textContent = Object.entries(PAGE_KINDS).map(([kind, label]) => `${getProject().pages.filter(page => page.kind === kind).length} ${t(label)}`).join(' · ');
  }
  $('pageList').addEventListener('click', safeAction(event => {
    const remove = event.target.closest('[data-delete-page-id]');
    if (remove) { requestPageDeletion(remove.dataset.deletePageId); return; }
    const button = event.target.closest('[data-page-id]');
    if (!button || button.dataset.pageId === getProject().activePageId) return;
    finishGesture(); applyPageChange(switchPage(getProject(), button.dataset.pageId), t('切换编辑页面'));
  }));
  for (const [id, kind] of [['addPageBtn', 'page'], ['addPopupBtn', 'popup'], ['addToastBtn', 'toast']]) $(id).addEventListener('click', safeAction(() => {
    finishGesture(); applyPageChange(addPage(getProject(), kind), t`新增${t(PAGE_KINDS[kind])}`);
    notify(t`已新增${t(PAGE_KINDS[kind])}`);
  }));
  let managedPageId = null;
  const PAGE_DELETE_CONFIRMATION_KEY = 'protolab.skipPageDeleteConfirmation';
  let skipPageDeleteConfirmation = false;
  try { skipPageDeleteConfirmation = localStorage.getItem(PAGE_DELETE_CONFIRMATION_KEY) === 'true'; } catch { /* 存储不可用时仍显示确认。 */ }
  let pendingPageDeletion = null;
  function performPageDeletion(id) {
    finishGesture(); applyPageChange(deletePage(getProject(), id), t('删除页面或弹窗'));
    if ($('pageDialog').open) $('pageDialog').close();
    notify(t('已删除，关联跳转已清除，可撤销恢复'));
  }
  function requestPageDeletion(id) {
    const page = getProject().pages.find(page => page.id === id);
    if (!page) return;
    if (page.kind === 'page' && getProject().pages.filter(page => page.kind === 'page').length === 1) {
      notify(t('至少保留一个普通页面'), true); return;
    }
    if (skipPageDeleteConfirmation) { performPageDeletion(id); return; }
    finishGesture(); pendingPageDeletion = { id, session: getSession() };
    $('deletePageDescription').textContent = t`确认删除「${page.name}」？关联动作将被清除，删除后可撤销恢复。`;
    $('skipPageDeleteConfirmation').checked = false;
    $('deletePageDialog').showModal();
  }
  $('deletePageDialog').addEventListener('close', () => { pendingPageDeletion = null; });
  $('deletePageForm').addEventListener('submit', safeAction(event => {
    event.preventDefault();
    if (!pendingPageDeletion || pendingPageDeletion.session !== getSession()) { $('deletePageDialog').close(); return; }
    performPageDeletion(pendingPageDeletion.id);
    if ($('skipPageDeleteConfirmation').checked) {
      skipPageDeleteConfirmation = true;
      try { localStorage.setItem(PAGE_DELETE_CONFIRMATION_KEY, 'true'); } catch { /* 当前会话仍记住选择。 */ }
    }
    $('deletePageDialog').close();
  }));
  $('managePageBtn').addEventListener('click', () => {
    finishGesture(); const page = activePage(getProject()); managedPageId = page.id;
    $('pageName').value = page.name; $('pageError').textContent = '';
    $('pageStart').checked = page.id === getProject().startPageId; $('pageStart').disabled = page.kind !== 'page';
    $('deletePageBtn').disabled = page.kind === 'page' && getProject().pages.filter(page => page.kind === 'page').length === 1;
    $('pageDialog').showModal();
  });
  $('pageForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('pageName').value.trim();
    if (!name) { $('pageError').textContent = t('请输入页面名称'); return; }
    const page = getProject().pages.find(page => page.id === managedPageId);
    page.name = name;
    if (page.kind === 'page' && $('pageStart').checked) getProject().startPageId = page.id;
    commit(t('更新页面名称与首页')); $('pageDialog').close(); saveProject(t('保存页面设置'));
  });
  $('duplicatePageBtn').addEventListener('click', safeAction(() => {
    applyPageChange(addPage(getProject(), 'page', true), t('复制页面或弹窗')); $('pageDialog').close();
  }));
  $('deletePageBtn').addEventListener('click', safeAction(() => requestPageDeletion(managedPageId)));
  return { renderPages, renderInteractionTargets, readInteraction };
}
