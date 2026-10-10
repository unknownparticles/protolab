import { resolve } from 'node:path';
import { MCP_CLIENTS, mcpConfig } from '../src/mcp-config.js';

const client = process.argv[2];
if (!MCP_CLIENTS[client]) {
  console.error(`用法：node scripts/mcp-config.mjs <${Object.keys(MCP_CLIENTS).join('|')}> [本地服务地址]`);
  process.exitCode = 1;
} else console.log(mcpConfig(client, { command: process.execPath, script: resolve(import.meta.dirname, 'mcp-server.mjs'), url: process.argv[3] || `http://127.0.0.1:${process.env.PORT || 4173}` }));
