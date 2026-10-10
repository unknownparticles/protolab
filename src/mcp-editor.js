import { clone } from './model.js';
import { withPages, switchPage, addPage } from './pages.js';
import { DESIGN_SPEC, parseAIResponse } from './ai.js';
import { MCP_CHANGE_PROTOCOL, validateToolArguments } from './mcp-protocol.js';

/** 只在浏览器内读写模型，复用现有内容清理、校验、历史和版本。 */
export function createMCPEditor({ getState, getAssets, sanitize, apply, exportFile, isBusy = () => false }) {
  let fingerprint = '', revision = 0;
  function state() {
    const current = getState();
    const serialized = JSON.stringify(current);
    if (serialized !== fingerprint) { fingerprint = serialized; revision++; }
    return { ...clone(current), revision };
  }
  function execute(name, args) {
    validateToolArguments(name, args);
    const current = state();
    if (name === 'protolab_export') return { revision: current.revision, ...exportFile(args.format) };
    const project = withPages(current.project);
    const base = args.pageId ? switchPage(project, args.pageId) : project;
    const assets = getAssets(base);
    if (name === 'protolab_get_project') {
      const { library, libraryGroups, ...publicState } = current;
      return { ...publicState, project: base, designContext: assets.context, designSpec: DESIGN_SPEC, changeProtocol: MCP_CHANGE_PROTOCOL };
    }
    if (args.expectedRevision !== current.revision) throw new Error('工程已改变，请重新读取工程后再提交修改');
    if (isBusy()) throw new Error('编辑器正在拖动或处理 AI 结果，请结束当前操作后再试');
    let next, label, pageId;
    if (name === 'protolab_apply_changes') {
      next = parseAIResponse(JSON.stringify({ version: 1, summary: args.summary, changes: args.changes }), base, sanitize, { library: assets.library, designContext: assets.context }).project;
      // 编辑非当前页时保留用户正在查看的页面。
      if (next.activePageId !== project.activePageId) next = switchPage(next, project.activePageId);
      label = `MCP：${args.summary}`;
    } else if (name === 'protolab_create_page') {
      next = addPage(project, args.kind || 'page');
      pageId = next.activePageId;
      next.pages = next.pages.map(page => page.id === pageId ? { ...page, name: args.name.trim() } : page);
      if (args.changes?.some(change => !['add', 'canvas', 'frame', 'safeArea'].includes(change?.op))) throw new Error('新页面只能新增组件或设置画布、外框和安全区');
      const linked = getAssets(next);
      next = parseAIResponse(JSON.stringify({ version: 1, summary: args.name, changes: args.changes || [] }), next, sanitize, { library: linked.library, designContext: linked.context }).project;
      label = `MCP：${args.name}`;
    } else throw new Error('此工具不在编辑器中执行');
    apply(next, label);
    return { revision: state().revision, projectId: current.projectId, activePageId: next.activePageId, ...(pageId ? { pageId } : {}), summary: label };
  }
  return { state, execute };
}
