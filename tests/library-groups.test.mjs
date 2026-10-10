import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGroups, mergeLibrary } from '../src/library-groups.js';
import { validateLibrary, createHistory } from '../src/model.js';
import { projectRecord, validateProjects, emptyProject } from '../src/projects.js';

const sanitize = value => value;
const component = (id, groupId = '') => validateLibrary([{ id, groupId, name: '卡片', content: '<div>卡片</div>', type: 'html' }], sanitize)[0];

test('组件和空分组可随工程恢复，历史撤销重做保留完整分组快照', () => {
  const libraryGroups = [{ id: 'cards', name: '卡片' }, { id: 'empty', name: '空分组' }];
  const library = [component('one', 'cards')];
  const record = { ...projectRecord({ name: '原型' }, emptyProject(), library), libraryGroups };
  const catalog = validateProjects({ version: 1, activeId: record.id, entries: [record] }, sanitize);
  assert.deepEqual(catalog.entries[0].libraryGroups, libraryGroups);
  assert.equal(catalog.entries[0].library[0].groupId, 'cards');
  const history = createHistory({ library, libraryGroups });
  history.push({ library: [component('one')], libraryGroups: [] }, '删除分组');
  assert.deepEqual(history.undo().libraryGroups, libraryGroups);
  assert.equal(history.redo().library[0].groupId, '');
});

test('合并导入匹配同名分组，解决标识冲突，保留已有组件且重复导入不重复添加', () => {
  const groups = [{ id: 'local', name: '卡片' }];
  const original = component('one', 'local');
  const incoming = { ...component('one', 'remote'), name: '导入卡片' };
  const merged = mergeLibrary([original], groups, [incoming], [{ id: 'remote', name: '卡片' }, { id: 'local', name: '空分组' }]);
  assert.equal(merged.components.length, 2);
  assert.deepEqual(merged.components[0], original);
  assert.notEqual(merged.components[1].id, original.id);
  assert.equal(merged.components[1].groupId, 'local');
  assert.equal(merged.groups.length, 2);
  assert.notEqual(merged.groups[1].id, 'local');
  const repeated = mergeLibrary(merged.components, merged.groups, merged.components, merged.groups);
  assert.deepEqual(repeated, merged);
  assert.deepEqual(groups, [{ id: 'local', name: '卡片' }]);
});

test('损坏分组不能覆盖工程，旧组件库仍归入未分组', () => {
  assert.deepEqual(validateGroups(), []);
  assert.equal(component('legacy').groupId, '');
  for (const raw of [[{ id: '', name: '分组' }], [{ id: 'a', name: ' ' }], [{ id: 'a', name: '同名' }, { id: 'b', name: '同名' }], [{ id: 'a', name: '甲' }, { id: 'a', name: '乙' }]]) assert.throws(() => validateGroups(raw));
});
