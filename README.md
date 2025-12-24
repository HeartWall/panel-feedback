# Panel Feedback 💬

一个 VS Code / Windsurf 扩展，为 AI 助手（如 Cascade、Claude）提供嵌入式侧边栏交互面板，支持 MCP（Model Context Protocol）协议。

## ✨ 功能特性

### 核心功能
- **侧边栏面板** - 在 IDE 侧边栏显示 AI 消息，无弹窗打扰
- **编辑器模式** - 可在主编辑区打开，像普通 Tab 页一样操作
- **MCP 协议** - 标准 Model Context Protocol 支持，AI 可直接调用

### 交互增强
- **图片支持** - 粘贴 (Ctrl+V) 或拖拽上传图片
- **文件路径** - 拖拽文件/文件夹自动插入路径，支持快速选择
- **Markdown 渲染** - AI 消息支持完整 Markdown 格式
- **代码高亮** - 代码块自动语法高亮，一键复制

### 快捷操作
- **提交并推送** - 一键执行 git commit & push
- **代码审查** - 审查当前更改
- **整理格式** - 整理代码格式和排序

### 高级功能
- **Rules 设置** - 持久化规则，每次提交自动附加给 AI
- **多窗口支持** - 同时打开多个工作区，自动路由到正确窗口
- **工作区隔离** - 不同工作区的对话历史独立存储
- **请求持久化** - 未完成的请求会持久化，重启 IDE 后自动恢复
- **自动更新检查** - 启动时检查 GitHub 最新版本

## 📦 安装

### 方式一：从 VSIX 安装
1. 从 [Releases](https://github.com/fhyfhy17/panel-feedback/releases) 下载 `.vsix` 文件
2. VS Code / Windsurf 中按 `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 选择下载的文件安装

### 方式二：从源码构建
```bash
git clone https://github.com/fhyfhy17/panel-feedback.git
cd panel-feedback
npm install
npm run compile
npm run package
```

## 🔧 MCP 配置

1. 按 `Ctrl+Shift+P` → `Panel Feedback: Copy MCP Config`
2. 将配置粘贴到对应 IDE 的 MCP 配置文件：

| IDE | 配置文件路径 |
|-----|-------------|
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |

配置示例：
```json
{
  "mcpServers": {
    "panel-feedback": {
      "command": "node",
      "args": ["~/.panel-feedback/mcp-stdio-wrapper.js"]
    }
  }
}
```

> 💡 MCP 服务器会自动复制到 `~/.panel-feedback/` 目录，更新扩展后无需重新配置。

## 📖 使用方法

### 打开面板
- **侧边栏模式**: 点击活动栏的 💬 图标
- **编辑器模式**: 点击侧边栏标题栏的 🔗 按钮，或 `Ctrl+Shift+P` → `Panel Feedback: 在编辑器中打开`

### AI 调用方式
在 AI 规则中添加：
```
使用 panel_feedback MCP 工具与用户交互，workspace_hash 参数填写 "[你的工作区哈希]"
```
工作区哈希显示在面板底部状态栏。

### 快捷键
- `Enter` - 发送消息
- `Shift+Enter` - 换行
- `Ctrl+V` - 粘贴图片

### Rules 设置
点击 ⚙️ 设置按钮，在 Rules 标签页中设置规则，每次提交会自动附加给 AI。

## 🏗️ 技术架构

```
┌─────────────────┐     stdio      ┌──────────────────┐
│  AI (Cascade)   │ ◄────────────► │ mcp-stdio-wrapper│
└─────────────────┘                └────────┬─────────┘
                                            │ HTTP
                                            ▼
┌─────────────────┐   postMessage  ┌──────────────────┐
│  Webview Panel  │ ◄────────────► │   MCP Server     │
└─────────────────┘                │  (HTTP 19876+)   │
                                   └──────────────────┘
```

- **mcp-stdio-wrapper.js** - Stdio 到 HTTP 的桥接层，支持长时间等待（最长 7 天）
- **MCPServer** - 运行在扩展内的 HTTP 服务器，处理 MCP 请求
- **FeedbackPanelProvider** - Webview 面板，显示消息并收集用户反馈

## 🔌 MCP 工具

### panel_feedback
在 IDE 侧边栏显示消息并获取用户反馈。

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | ✅ | 显示给用户的消息，支持 Markdown |
| predefined_options | string[] | ❌ | 预定义的快捷选项按钮 |
| workspace | string | ❌ | 目标工作区完整路径 |
| workspace_hash | string | ❌ | 工作区哈希值（8位），用于多窗口路由 |

**返回：** 用户输入的文本，支持图片（Base64 格式）

## 📁 项目结构

```
panel-feedback/
├── src/
│   ├── extension.ts           # 扩展入口
│   ├── mcpServer.ts           # MCP HTTP 服务器
│   └── FeedbackPanelProvider.ts  # Webview 面板
├── mcp-stdio-wrapper.js       # Stdio 桥接脚本
├── resources/                 # 图标资源
└── package.json               # 扩展配置
```

## 📄 许可证

MIT License
