import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionScope } from '../src/selection.js';
import { parseAIResponse, requestAI } from '../src/ai.js';
import { validateProject } from '../src/model.js';
import { withPages } from '../src/pages.js';
const clean = value => value;
const item = (id, x = 20, y = 40) => ({ id, name: id, type: 'html', content: '<button>按钮</button>', x, y, width: 100, height: 40 });
const board = items => withPages(validateProject({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, items }, clean));
const reply = changes => JSON.stringify({ version: 1, summary: '优化所选', changes });

test('所选优化保留其他组件、页面设置及参考尺寸，返回范围用于请求约束', async () => {
  const base = board([item('chosen'), item('outside', 200, 300)]);
  const selection = selectionScope(base, ['chosen']);
  const options = { selection, referenceSpec: { width: 800, height: 900 }, designContext: { safeArea: { enabled: true, top: 50 } } };
  const result = parseAIResponse(reply([{ op: 'update', id: 'chosen', fields: { content: '<button>继续</button>', appearance: { background: '#2563eb' } } }]), base, clean, options).project;
  assert.deepEqual(result.items[1], base.items[1]); assert.deepEqual(result.canvas, base.canvas); assert.deepEqual(result.safeArea, base.safeArea);
  assert.equal(result.items[0].content, '<button>继续</button>');
  let sent;
  await requestAI({ url: 'https://example.test', model: 'mock' }, '优化按钮', base, [], undefined, async (_, request) => {
    sent = JSON.parse(request.body); return { ok: true, json: async () => ({ choices: [{ message: { content: reply([]) } }] }) };
  }, { selection });
  assert.deepEqual(JSON.parse(sent.messages.at(-1).content).selectionScope, selection);
  assert.match(sent.messages[0].content, /仅允许 update、remove/);
});

test('拒绝越界更新、页面改动、范围外新增及删除造成的关联清理，基线保持原样', () => {
  const base = board([item('chosen'), { ...item('outside', 200, 300), interaction: { type: 'visibility', targetIds: ['chosen'], mode: 'toggle' } }]);
  const snapshot = structuredClone(base), selection = selectionScope(base, ['chosen']);
  for (const changes of [
    [{ op: 'update', id: 'outside', fields: { name: '越界' } }],
    [{ op: 'canvas', fields: { background: '#000000' } }],
    [{ op: 'add', item: item('new', 200, 300) }],
    [{ op: 'remove', id: 'chosen' }],
  ]) assert.throws(() => parseAIResponse(reply(changes), base, clean, { selection }), /所选|未选/);
  const added = parseAIResponse(reply([{ op: 'add', item: { ...item('new'), width: 20, height: 20 } }]), base, clean, { selection });
  assert.equal(added.project.items.length, 3);
  assert.deepEqual(base, snapshot);
  assert.throws(() => selectionScope(base, []), /请先/);
});

test('选中容器覆盖内部组件，单独调整子组件不得间接移动未选兄弟', () => {
  const base = board([{ ...item('container'), content: '<div></div>', width: 300, height: 240, container: { mode: 'vertical', gap: 12 } },
    { ...item('child'), parentId: 'container' }, { ...item('sibling'), parentId: 'container' }, item('outside', 200, 350)]);
  const selection = selectionScope(base, ['container']);
  assert.deepEqual(selection.itemIds, ['container', 'child', 'sibling']);
  const result = parseAIResponse(reply([{ op: 'update', id: 'container', fields: { container: { mode: 'vertical', gap: 20 } } }]), base, clean, { selection }).project;
  assert.deepEqual(result.items.at(-1), base.items.at(-1));
  assert.throws(() => parseAIResponse(reply([{ op: 'update', id: 'child', fields: { layoutBasis: { width: 100, height: 80 } } }]), base, clean, { selection: selectionScope(base, ['child']) }), /未选/);
});
