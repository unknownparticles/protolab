# 通过 MCP 调用易设

Codex、Cursor、Claude Code、OpenCode 和 Antigravity 共用易设的标准 MCP stdio 服务。客户端启动 `scripts/mcp-server.mjs`，通过本机开发服务转发到用户连接的浏览器标签页。无需安装运行时依赖，也无需在易设里填写 AI API Key；模型由各客户端提供。

## 开始使用

1. 在本仓库运行 `npm run dev`，打开 http://127.0.0.1:4173。
2. 打开「工具 → MCP 接入」，点击「连接当前标签页」。选择要操作的工程；每个已连接标签页都有独立标识。
3. 在下拉框选择客户端，复制生成的配置，合并到对应配置文件。生成器使用当前 Node 可执行文件、服务脚本的绝对路径和实际端口，适用于从其他目录启动的客户端。
4. 重新加载客户端的 MCP 服务，在客户端提出需求，例如：「使用 protolab MCP 读取我连接的易设工程，设计一个登录页面，并导出可交互 HTML。」

客户端配置已有其他服务器时，仅合并 `protolab` 条目，保留已有配置。调用期间保持本地开发服务和目标标签页打开。关闭 MCP 设置窗口仍保持连接；点击「断开当前标签页」、刷新或关闭标签页会断开连接。刷新后重新连接并重新读取工程。

也可直接生成配置：

```sh
npm run --silent mcp:config -- codex
npm run --silent mcp:config -- cursor
npm run --silent mcp:config -- claude
npm run --silent mcp:config -- opencode
npm run --silent mcp:config -- antigravity
```

自定义端口时，浏览器里的配置会自动使用当前服务端口。命令行生成器可显式指定地址，例如 `npm run --silent mcp:config -- cursor http://127.0.0.1:8080`。

## 五种客户端

| 客户端 | 配置位置 | 配置结构 |
| --- | --- | --- |
| Codex | `~/.codex/config.toml`，或可信项目的 `.codex/config.toml` | `[mcp_servers.protolab]`，`command` 和 `args` |
| Cursor | 工程的 `.cursor/mcp.json`，或 `~/.cursor/mcp.json` | `mcpServers.protolab`，`command` 和 `args` |
| Claude Code | 工程的 `.mcp.json` | `mcpServers.protolab`，`command` 和 `args` |
| OpenCode | 工程的 `opencode.json` / `opencode.jsonc` | `mcp.protolab`，`type: "local"` 和 `command` 数组 |
| Antigravity | `~/.gemini/config/mcp_config.json`，或工程的 `.agents/mcp_config.json` | `mcpServers.protolab`，`command` 和 `args` |

Codex 也可以从本仓库目录执行：

```sh
codex mcp add protolab -- node "$PWD/scripts/mcp-server.mjs" --url http://127.0.0.1:4173
```

Claude Code 也可以从本仓库目录执行：

```sh
claude mcp add --transport stdio --scope project protolab -- node "$PWD/scripts/mcp-server.mjs" --url http://127.0.0.1:4173
```

GUI 启动的客户端若找不到 `node`，使用界面或配置生成器提供的绝对路径。Antigravity 可从 MCP Servers → Manage MCP Servers → View raw config 打开当前版本实际使用的配置；旧版路径可能不同，以客户端打开的文件为准。

客户端连接类型选择 stdio。`--url` 是易设本地桥的地址，不能将它直接配置为客户端的远程 HTTP MCP 地址。stdio 配置直接使用 Node 命令；`npm run mcp` 的 npm 日志可能混入协议输出，仅用于手动调试。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `protolab_list_sessions` | 列出已连接标签页和当前工程；多个标签页时选择明确的 `sessionId` |
| `protolab_get_project` | 读取工程全部页面、指定页编辑视图、设计规范、配色、组件清单、安全区及 `revision` |
| `protolab_apply_changes` | 新增、更新、删除组件，设置画布、设备外框与安全区 |
| `protolab_create_page` | 新建页面、弹窗或 Toast，可一次提交初始化组件，成功后切换至新页面 |
| `protolab_export` | 返回可独立打开的 HTML 或可重新导入的工程 JSON；由客户端保存 `content` 文本为文件 |

先读取工程，再使用返回的 `revision` 作为写操作的 `expectedRevision`。人工编辑、工程切换、页面切换、组件库或工程规范变化后，旧请求会被拒绝；重新读取并根据新状态决定修改。并发客户端使用同一个版本写入时，先成功的请求会使其他请求失效。

`changes` 复用现有 AI 变更协议。读取结果里的 `changeProtocol` 提供完整字段说明，以下为新增组件示例：

```json
{
  "sessionId": "从标签页清单取得",
  "expectedRevision": 1,
  "summary": "增加登录标题",
  "changes": [
    {
      "op": "add",
      "item": {
        "id": "login-title",
        "name": "登录标题",
        "type": "html",
        "content": "<h1 style=\"color:#2563eb\">欢迎登录</h1>",
        "x": 24,
        "y": 100,
        "width": 280,
        "height": 60
      }
    }
  ]
}
```

指定 `pageId` 可读取和修改非当前页，修改成功后保留用户当前查看的页面。可以通过 `libraryId` 复用关联组件清单中的组件。新建页面的初始化操作只支持 `add`、`canvas`、`frame`、`safeArea`，每批变更全部校验后一次应用。

## 保存与使用范围

- 写入复用内容清理、模型校验、安全区和组件库范围限制，脚本、事件属性等活动内容被清理。每批写入形成一个可撤销步骤，并保留修改前后的版本。
- 拖动组件、等待 AI 请求、待合并结果或未保存的 AI 生成预览期间暂时拒绝 MCP 写入；完成相关操作后重新读取工程再提交。
- 设计与组件库仍保存在原浏览器来源的本地存储中。客户端会收到其请求的设计内容；接口设置、API Key、对话和版本历史不随 MCP 工程读取或导出发送。
- 服务只监听本机回环地址，浏览器仅连接同源本地桥。连接令牌仅用于本次服务运行，不进入客户端配置和工程导出。页面刷新后使用新标签页标识，旧标识不能继续写入。
- 工具超时、取消或连接中断后先重新读取工程核对；操作可能已执行但响应未送达。服务不会重放已交付的操作，也不会在标签页恢复后执行已过期的排队操作。
- 当前支持本地运行。GitHub Pages 上的静态版本可查看接入说明，使用 MCP 时需打开本地开发服务。网上版本已有工程需先导出工程 JSON，再在本地导入；不同浏览器来源的存储互相独立。
- 已验证标准 stdio 协议和 Chromium 中的完整编辑流程，并核对五种客户端的官方配置格式；各客户端的安装、授权策略和版本差异仍由其自身管理，未逐个运行五种客户端应用。

## 验证

```sh
npm test
npm run check
npm run test:mcp
```

前两项无安装依赖，传输测试需要允许监听本机临时端口。浏览器验收需要开发用 Playwright 和 Chromium，与其他浏览器验收脚本共用 `PROTOLAB_PLAYWRIGHT_MODULE`、`PROTOLAB_BROWSER_EXECUTABLE` 和 `PROTOLAB_TEST_URL` 环境变量。

浏览器验收通过真实标准输入输出调用覆盖组件修改与复用、整批校验、内容清理、并发版本检查、多个标签页、撤销重做、新建弹窗、指定页修改、工程及 HTML 导出、独立原型交互、版本持久化、断开及重新连接、五种配置生成、复制、双语与窄屏。

官方配置说明：[OpenAI Docs：Codex MCP](https://developers.openai.com/codex/mcp)、[Cursor](https://cursor.com/docs/context/mcp)、[Claude Code](https://code.claude.com/docs/en/mcp)、[OpenCode](https://opencode.ai/docs/mcp-servers/)、[Antigravity](https://antigravity.google/docs/mcp)。
