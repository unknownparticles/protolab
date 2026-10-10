import { uid } from './model.js';

export function validateGroups(raw = []) {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('组件分组最多支持一百个');
  const ids = new Set(), names = new Set();
  return raw.map(group => {
    if (!group || typeof group.id !== 'string' || !group.id || group.id.length > 100 || ids.has(group.id)) throw new Error('组件分组标识无效或重复');
    const name = typeof group.name === 'string' ? group.name.trim() : '';
    if (!name || name.length > 40 || names.has(name)) throw new Error('分组名称须为一至四十个字符且不能重复');
    ids.add(group.id); names.add(name);
    return { id: group.id, name };
  });
}

/** 合并导入时保留现有组件；同名分组合并，冲突标识重新分配。 */
export function mergeLibrary(current, groups, incoming, incomingGroups = []) {
  const nextGroups = validateGroups(groups), mapping = new Map();
  for (const group of validateGroups(incomingGroups)) {
    let target = nextGroups.find(value => value.name === group.name);
    if (!target) {
      target = { ...group, id: nextGroups.some(value => value.id === group.id) ? uid() : group.id };
      nextGroups.push(target);
    }
    mapping.set(group.id, target.id);
  }
  const components = [...current];
  for (const component of incoming.filter(value => !value.builtin)) {
    const groupId = mapping.get(component.groupId) || '';
    const value = { ...component, groupId };
    const existing = components.find(entry => entry.id === value.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(value)) continue;
    if (existing) value.id = uid();
    components.push(value);
  }
  return { components, groups: validateGroups(nextGroups) };
}
