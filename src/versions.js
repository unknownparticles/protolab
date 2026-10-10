import { clone, uid } from './model.js';

export const WORKSPACE_KEY = 'protolab.workspace.v1';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createVersions(initial, raw) {
  let entries = raw ? clone(raw.entries) : [{ id: uid(), parent: null, label: '初始版本', createdAt: new Date().toISOString(), project: clone(initial) }];
  let head = raw?.head || entries[0].id;
  return {
    get entries() { return clone(entries); },
    get head() { return head; },
    get current() { return clone(entries.find(entry => entry.id === head).project); },
    add(project, label = '手动修改', options = {}) {
      if (!options.branch && !options.mergeParent && equal(project, this.current)) return head;
      const entry = { id: uid(), parent: options.parent || head, label, createdAt: new Date().toISOString(), project: clone(project), ...(options.mergeParent ? { mergeParent: options.mergeParent } : {}) };
      entries.push(entry);
      if (!options.branch) head = entry.id;
      return entry.id;
    },
    checkout(id) {
      const entry = entries.find(value => value.id === id);
      if (!entry) throw new Error('版本不存在');
      head = id;
      return clone(entry.project);
    },
    serialize() { return { head, entries: clone(entries) }; },
  };
}
export function validateWorkspace(raw, validate) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.versions?.entries) || !raw.versions.entries.length) throw new Error('版本记录格式不正确');
  const ids = new Set();
  const entries = raw.versions.entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || typeof entry.label !== 'string' || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('版本记录损坏');
    ids.add(entry.id);
    return { ...entry, project: validate(entry.project) };
  });
  if (!ids.has(raw.versions.head) || entries.some(entry => entry.parent && !ids.has(entry.parent) || entry.mergeParent && !ids.has(entry.mergeParent))) throw new Error('版本关联损坏');
  const messages = Array.isArray(raw.messages) ? raw.messages.map(message => {
    if (!message || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string') throw new Error('对话记录损坏');
    return { role: message.role, content: message.content };
  }) : [];
  let pending = null;
  if (raw.pending) {
    if (!ids.has(raw.pending.baseId) || !ids.has(raw.pending.aiId) || typeof raw.pending.summary !== 'string') throw new Error('待合并版本损坏');
    pending = { baseId: raw.pending.baseId, aiId: raw.pending.aiId, summary: raw.pending.summary };
  }
  return { version: 1, savedAt: raw.savedAt, versions: { head: raw.versions.head, entries }, messages, pending };
}

/** 三方合并：组件以稳定标识匹配；同一组件的不同字段可自动合并。 */
export function mergeProjects(base, local, remote, choices = {}) {
  const conflicts = [];
  function merge(b, l, r, path) {
    if (equal(l, r) || equal(r, b)) return clone(l);
    if (equal(l, b)) return clone(r);
    if ([b, l, r].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
      const result = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(b[key], l[key], r[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    const key = JSON.stringify(path);
    conflicts.push({ key, path, base: clone(b), local: clone(l), remote: clone(r) });
    return clone(choices[key] === 'ai' ? r : l);
  }
  const project = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (key !== 'items') project[key] = merge(base[key], local[key], remote[key], [key]);
  }
  const maps = [base, local, remote].map(project => new Map(project.items.map(item => [item.id, item])));
  const ids = new Set([...maps[1].keys(), ...maps[2].keys(), ...maps[0].keys()]);
  project.items = [];
  for (const id of ids) {
    const item = merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), ['items', id]);
    if (item !== undefined) project.items.push(item);
  }
  return { project, conflicts };
}
