export const MCP_CLIENTS = Object.freeze({
  codex: { name: 'Codex', file: '~/.codex/config.toml' },
  cursor: { name: 'Cursor', file: '.cursor/mcp.json' },
  claude: { name: 'Claude Code', file: '.mcp.json' },
  opencode: { name: 'OpenCode', file: 'opencode.json' },
  antigravity: { name: 'Antigravity', file: '~/.gemini/config/mcp_config.json' },
});

export function mcpConfig(client, { command = 'node', script, url = 'http://127.0.0.1:4173' }) {
  if (!MCP_CLIENTS[client] || !script) throw new Error('请选择有效的客户端并提供服务脚本路径');
  const args = [script, '--url', url];
  if (client === 'codex') return `[mcp_servers.protolab]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;
  if (client === 'opencode') return JSON.stringify({ mcp: { protolab: { type: 'local', command: [command, ...args], enabled: true } } }, null, 2);
  return JSON.stringify({ mcpServers: { protolab: { command, args } } }, null, 2);
}
