import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS } from '../src/presets.js';
import { emptyProject, projectRecord, validateProjects, saveActiveProject, activateProject, appendProject, projectDetails, MAX_PROJECTS } from '../src/projects.js';
import { createVersions } from '../src/versions.js';
const clean = value => value;
const catalog = () => {
  const entry = projectRecord({ name: '原工程', rules: '蓝色主色' }, emptyProject(), COMPONENTS);
  return { version: 1, activeId: entry.id, entries: [entry] };
};
test('保存和切换工程隔离页面、组件库、对话、版本和规范，快照不共享引用', () => {
  const original = catalog();
  const snapshot = structuredClone(original.entries[0]);
  snapshot.project.items.push({ ...COMPONENTS[0], id: 'local', x: 20, y: 40, width: 100, height: 40 });
  const versions = createVersions(snapshot.project);
  snapshot.workspace = { version: 1, versions: versions.serialize(), messages: [{ role: 'user', content: '原工程需求' }], pending: null };
  let next = saveActiveProject(original, { project: snapshot.project, workspace: snapshot.workspace });
  const second = projectRecord({ name: '新工程', rules: '红色主色' }, emptyProject('pc'), COMPONENTS);
  next = appendProject(next, second);
  second.project.canvas.width = 200;
  assert.equal(next.entries[1].project.canvas.width, 1280);
  assert.equal(next.entries[1].project.items.length, 0);
  assert.equal(next.entries[1].workspace.messages.length, 0);
  next = activateProject(next, original.activeId);
  const restored = validateProjects(next, clean).entries[0];
  assert.equal(restored.project.items.length, 1);
  assert.equal(restored.workspace.messages[0].content, '原工程需求');
  assert.equal(restored.rules, '蓝色主色');
  assert.equal(original.entries[0].project.items.length, 0);
  assert.throws(() => activateProject(next, 'missing'), /不存在/);
});
test('旧草稿与已有版本可以直接作为首个工程，不损失待合并记录', () => {
  const project = emptyProject();
  const versions = createVersions(project);
  const baseId = versions.head;
  const aiId = versions.add({ ...project, canvas: { ...project.canvas, width: 400 } }, '智能结果', { branch: true });
  const entry = projectRecord({ name: '迁移工程' }, project, COMPONENTS, { version: 1, versions: versions.serialize(), messages: [], pending: { baseId, aiId, summary: '调整尺寸' } });
  const restored = validateProjects({ version: 1, activeId: entry.id, entries: [entry] }, clean);
  assert.deepEqual(restored.entries[0].workspace.pending, entry.workspace.pending);
  assert.equal(restored.entries[0].workspace.versions.entries.length, 2);
});
test('工程列表拒绝损坏的非当前工程、重复标识和非法规范', () => {
  const original = catalog();
  const next = appendProject(original, projectRecord({ name: '另一个工程' }, emptyProject(), COMPONENTS));
  for (const mutate of [
    value => { value.entries[0].workspace.versions.head = 'missing'; },
    value => { value.entries[0].library = [{ name: '损坏组件' }]; },
    value => { value.entries[1].id = value.entries[0].id; },
    value => { value.activeId = 'missing'; },
    value => { value.entries[0].rules = {}; },
  ]) { const damaged = structuredClone(next); mutate(damaged); assert.throws(() => validateProjects(damaged, clean)); }
  assert.throws(() => projectDetails({ name: '  ' }));
  assert.throws(() => projectDetails({ name: '工程', rules: '字'.repeat(10001) }));
});
test('工程数量达到上限时拒绝新建且保留原工程列表', () => {
  const source = catalog();
  source.entries = Array.from({ length: MAX_PROJECTS }, (_, index) => ({ ...structuredClone(source.entries[0]), id: String(index) }));
  source.activeId = '0';
  assert.throws(() => appendProject(source, projectRecord({ name: '过量工程' }, emptyProject(), [])), /50/);
  assert.equal(source.entries.length, MAX_PROJECTS);
});
