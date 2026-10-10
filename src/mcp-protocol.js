import { AI_PROMPT } from './ai.js';

export { MCP_INSTRUCTIONS, MCP_TOOLS, validateToolArguments } from './mcp-tools.js';
export const MCP_CHANGE_PROTOCOL = `${AI_PROMPT}\n复用关联清单中的组件时，add.item 可为 {"id":"新标识","libraryId":"清单组件标识","x":0,"y":0}，可补充 name、width、height 等基础属性，不提供 type 和 content；仅支持本轮 designContext.library 中的标识。`;
