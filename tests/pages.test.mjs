import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, createHistory, rotateProject } from '../src/model.js';
import { withPages, switchPage, syncPages, addPage, deletePage, normalizeInteraction, copyItems, cleanVisibilityTargets } from '../src/pages.js';
import { mergeProjects, createVersions, validateWorkspace } from '../src/versions.js';
import { parseAIResponse } from '../src/ai.js';
import { exportHTML } from '../src/content.js';
const clean = value => value;
const initial = () => withPages(validateProject({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, items: [{ id: 'button', name: '下一页', type: 'html', content: '<button>下一页</button>', x: 20, y: 500, width: 100, height: 40 }] }, clean));
const reply = changes => JSON.stringify({ version: 1, summary: '修改当前页', changes });

test('提示独立编辑与导出，动作验证提示类型、时长，删除后清除引用', () => {
  let project = addPage(initial(), 'toast');
  const toastId = project.activePageId;
  assert.equal(project.canvas.height, 100);
  assert.equal(project.items.length, 1);
  assert.match(exportHTML(project, { preview: true }), new RegExp(`data-initial-toast="${toastId}"`));
  project = switchPage(project, 'page-home');
  project.items[0].interaction = { type: 'showToast', targetId: toastId, duration: 800 };
  project = validateProject(project, clean);
  assert.match(exportHTML(project), /data-prototype-toast=/);
  assert.equal(project.items[0].interaction.duration, 800);
  const wrong = structuredClone(project); wrong.items[0].interaction.targetId = 'page-home';
  assert.throws(() => validateProject(wrong, clean), /类型/);
  for (const duration of [0, 199, 10001, 'bad', 250.5]) assert.throws(() => normalizeInteraction({ type: 'showToast', targetId: toastId, duration }));
  assert.equal(deletePage(project, toastId).items[0].interaction, undefined);
});

test('初始隐藏与整组显隐保留在工程中，拒绝跨页目标及非法状态', () => {
  const project = initial();
  project.items.push({ ...project.items[0], id: 'content', visible: false });
  project.items[0].interaction = { type: 'visibility', mode: 'toggle', targetIds: ['content', 'content'] };
  const validated = validateProject(project, clean);
  assert.deepEqual(validated.items[0].interaction.targetIds, ['content']);
  assert.equal(validated.items[1].visible, false);
  assert.match(exportHTML(validated), /data-element-id="content"[^>]* hidden/);
  const wrong = structuredClone(validated); wrong.items[0].interaction.targetIds = ['missing'];
  assert.throws(() => validateProject(wrong, clean), /当前页面/);
  for (const action of [{ type: 'visibility', targetIds: [], mode: 'toggle' }, { type: 'visibility', targetIds: ['content'], mode: 'invalid' }]) assert.throws(() => normalizeInteraction(action));
  wrong.items[0].interaction = undefined; wrong.items[1].visible = 'false';
  assert.throws(() => validateProject(wrong, clean), /布尔/);
});

test('复制板块重连显隐目标，删除部分目标保留其他目标，全部删除清除动作', () => {
  const items = [initial().items[0], { ...initial().items[0], id: 'a' }, { ...initial().items[0], id: 'b' }];
  items[0].interaction = { type: 'visibility', mode: 'show', targetIds: ['a', 'b'] };
  const copies = copyItems(items);
  assert.deepEqual(copies[0].interaction.targetIds, copies.slice(1).map(item => item.id));
  assert.deepEqual(copyItems([items[0]])[0].interaction.targetIds, ['a', 'b']);
  assert.deepEqual(cleanVisibilityTargets(items.slice(0, 2))[0].interaction.targetIds, ['a']);
  assert.equal(cleanVisibilityTargets(items.slice(0, 1))[0].interaction, undefined);
  assert.deepEqual(items[0].interaction.targetIds, ['a', 'b']);
  const project = initial(); project.items = items;
  const page = addPage(project, 'page', true);
  assert.deepEqual(page.items[0].interaction.targetIds, page.items.slice(1).map(item => item.id));
});

test('智能修改支持提示、显隐与初始隐藏，删除目标清理动作', () => {
  let project = addPage(initial(), 'toast'); const toast = project.activePageId;
  project = switchPage(project, 'page-home');
  project.items.push({ ...project.items[0], id: 'content' });
  const result = parseAIResponse(reply([
    { op: 'update', id: 'button', fields: { interaction: { type: 'showToast', targetId: toast, duration: 1000 } } },
    { op: 'update', id: 'content', fields: { visible: false, interaction: { type: 'visibility', targetIds: ['button'], mode: 'hide' } } },
  ]), project, clean).project;
  assert.equal(result.items[1].visible, false);
  assert.equal(parseAIResponse(reply([{ op: 'remove', id: 'button' }]), result, clean).project.items[0].interaction, undefined);
});

test('旧草稿迁移，切换保存各页布局与方向，不改变原始项目', () => {
  const source = initial();
  let project = addPage(source);
  assert.equal(source.pages.length, 1);
  assert.equal(source.items.length, 1);
  const second = project.activePageId;
  project.canvas.width = 600;
  project = switchPage(project, 'page-home');
  project = rotateProject(project);
  project = switchPage(project, second);
  assert.equal(project.canvas.width, 600);
  assert.equal(project.items.length, 0);
  project = switchPage(project, 'page-home');
  assert.equal(project.canvas.width, 667);
  assert.equal(project.items[0].y, 500);
  assert.deepEqual(validateProject(project, clean), project);
});

test('复制页面与弹窗生成新标识，内容和跳转独立，新增达到上限时拒绝', () => {
  const source = initial();
  source.items[0].interaction = { type: 'navigate', targetId: 'page-home' };
  const copy = addPage(source, 'page', true);
  assert.notEqual(copy.items[0].id, source.items[0].id);
  copy.items[0].name = '副本按钮';
  assert.equal(source.items[0].name, '下一页');
  assert.equal(copy.items[0].interaction.targetId, 'page-home');
  const popup = addPage(copy, 'popup');
  assert.equal(popup.frame.style, 'none');
  assert.equal(popup.frame.device, 'pc');
  assert.equal(popup.canvas.width, 320);
  assert.equal(addPage(popup, 'page', true).pages.at(-1).kind, 'popup');
  let full = source;
  for (let i = 1; i < 30; i++) full = addPage(full);
  assert.throws(() => addPage(full), /30/);
});

test('删除目标页面清理所有关联跳转，首页回退，撤销重做完整恢复', () => {
  let project = addPage(initial());
  const target = project.activePageId;
  project.startPageId = target;
  project = switchPage(project, 'page-home');
  project.items[0].interaction = { type: 'navigate', targetId: target };
  project = syncPages(project);
  const history = createHistory(project);
  const removed = deletePage(project, target);
  assert.equal(removed.startPageId, 'page-home');
  assert.equal(removed.items[0].interaction, undefined);
  assert.equal(removed.pages[0].items[0].interaction, undefined);
  history.push(removed);
  assert.deepEqual(history.undo(), project);
  assert.deepEqual(history.redo(), removed);
  assert.throws(() => deletePage(removed, 'page-home'), /至少/);
});

test('未编辑页面也验证内容、页面标识、首页与目标类型，拒绝损坏工程', () => {
  const source = addPage(initial(), 'popup');
  for (const mutate of [
    p => { p.pages[0].items[0].type = 'script'; },
    p => { p.pages[1].id = p.pages[0].id; },
    p => { p.startPageId = p.activePageId; },
    p => { p.items = [{ ...initial().items[0], interaction: { type: 'navigate', targetId: p.activePageId } }]; },
    p => { p.items = [{ ...initial().items[0], interaction: { type: 'openPopup', targetId: 'missing' } }]; },
    p => { p.pages[1].kind = 'invalid'; },
  ]) { const project = structuredClone(source); mutate(project); assert.throws(() => validateProject(project, clean)); }
  assert.equal(normalizeInteraction({ type: 'none' }), undefined);
  assert.throws(() => normalizeInteraction({ type: 'script' }));
});

test('等待智能修改时切换并编辑另一个页面，合并保留两页修改及当前页', () => {
  let base = addPage(initial());
  const second = base.activePageId;
  base.items = [{ ...initial().items[0], id: 'second-button' }];
  base = switchPage(base, 'page-home');
  let local = switchPage(base, second);
  local.items[0].name = '第二页本地修改';
  local = syncPages(local);
  const remote = parseAIResponse(reply([{ op: 'update', id: 'button', fields: { name: '首页智能修改' } }]), base, clean).project;
  const result = mergeProjects(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.project.activePageId, second);
  assert.equal(result.project.items[0].name, '第二页本地修改');
  assert.equal(result.project.pages[0].items[0].name, '首页智能修改');
  assert.deepEqual(validateProject(result.project, clean), result.project);
});

test('同页不同字段自动合并，同字段与删除编辑冲突可选择', () => {
  const base = initial(), local = structuredClone(base), remote = structuredClone(base);
  local.items[0].x = 80; remote.items[0].name = '新名称';
  let result = mergeProjects(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.project.items[0].x, 80);
  assert.equal(result.project.items[0].name, '新名称');
  remote.items[0].x = 100;
  result = mergeProjects(base, local, remote);
  assert.equal(result.conflicts.length, 1);
  assert.equal(mergeProjects(base, local, remote, { [result.conflicts[0].key]: 'ai' }).project.items[0].x, 100);
  let two = addPage(base); const second = two.activePageId;
  const changed = structuredClone(two); changed.items = [{ ...base.items[0], id: 'new' }];
  const deleted = deletePage(two, second);
  result = mergeProjects(two, deleted, changed);
  assert.equal(result.conflicts.length, 1);
  const restored = mergeProjects(two, deleted, changed, { [result.conflicts[0].key]: 'ai' });
  assert.equal(restored.project.pages.find(page => page.id === second).items.length, 1);
});

test('智能修改可配置动作，校验目标，保留未涉及页面，版本备份包含全部页面', () => {
  let project = addPage(initial(), 'popup'); const popup = project.activePageId;
  project = switchPage(project, 'page-home');
  const response = parseAIResponse(reply([{ op: 'update', id: 'button', fields: { interaction: { type: 'openPopup', targetId: popup } } }]), project, clean);
  assert.equal(response.project.items[0].interaction.targetId, popup);
  assert.deepEqual(response.project.pages[1], project.pages[1]);
  assert.throws(() => parseAIResponse(reply([{ op: 'update', id: 'button', fields: { interaction: { type: 'openPopup', targetId: 'missing' } } }]), project, clean));
  const cleared = parseAIResponse(reply([{ op: 'update', id: 'button', fields: { interaction: { type: 'none' } } }]), response.project, clean);
  assert.equal(cleared.project.items[0].interaction, undefined);
  const versions = createVersions(project); versions.add(response.project);
  const backup = validateWorkspace({ version: 1, versions: versions.serialize() }, p => validateProject(p, clean));
  assert.equal(backup.versions.entries.at(-1).project.pages.length, 2);
});

test('导出包含全部页与弹窗并从首页启动，预览可从当前页或弹窗启动，元数据转义', () => {
  let project = addPage(initial(), 'popup'); const popup = project.activePageId;
  project.pages[1].name = '</script><script>evil</script>';
  let html = exportHTML(project);
  assert.match(html, /data-start-page="page-home"/);
  assert.match(html, /data-prototype-popup=/);
  assert.equal(html.includes('data-initial-popup='), false);
  assert.equal(html.includes('<script>evil</script>'), false);
  assert.match(exportHTML(project, { preview: true }), new RegExp(`data-initial-popup="${popup}"`));
  project = addPage(project);
  html = exportHTML(project, { preview: true });
  assert.match(html, new RegExp(`data-start-page="${project.activePageId}"`));
});
