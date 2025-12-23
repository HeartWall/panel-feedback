# Panel Feedback 💬

一个 VS Code 扩展，为 AI 助手提供嵌入式侧边栏反馈面板，支持 MCP 协议。

## 功能特性

- 🎯 **侧边栏面板** - 在 IDE 侧边栏显示 AI 消息，无弹窗打扰
- 📑 **编辑器模式** - 可在主编辑区打开，像普通文件一样操作
- ⚡ **固定操作** - 内置快捷操作按钮（提交并推送、代码审查、整理格式）
- 📝 **Rules 设置** - 持久化规则，每次提交自动附加给 AI
- 📷 **图片支持** - 粘贴、拖拽上传图片
- 📎 **文件路径** - 拖拽文件/文件夹自动插入路径
- 🔌 **MCP 协议** - 标准 Model Context Protocol 支持

## 安装

1. 下载 `.vsix` 文件
2. VS Code 中按 `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 选择下载的文件安装

## MCP 配置

1. 按 `Ctrl+Shift+P` → `Panel Feedback: Copy MCP Config`
2. 将配置粘贴到 MCP 配置文件：
   - Windsurf: `~/.codeium/windsurf/mcp_config.json`
   - Cursor: `~/.cursor/mcp.json`

## 使用方法

### 侧边栏模式
点击侧边栏的 💬 图标打开面板

### 编辑器模式
- 点击侧边栏标题栏的 🔗 按钮
- 或按 `Ctrl+Shift+P` → `Panel Feedback: 在编辑器中打开`

### 固定操作
- 🚀 **提交并推送** - 提交更改并推送到远程
- 🔍 **代码审查** - 审查当前更改
- 📐 **整理格式** - 整理代码格式和排序

### Rules 设置
点击 ⚙️ 设置按钮，在 Rules 标签页中设置规则，每次提交会自动附加给 AI。

## 许可证

MIT License
