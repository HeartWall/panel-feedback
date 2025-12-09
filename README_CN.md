# Panel Feedback 💬

[🇺🇸 English](./README.md) | [🇨🇳 中文文档](#panel-feedback-)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NPM Package](https://img.shields.io/badge/NPM-panel--feedback--mcp-red.svg)](https://www.npmjs.com/package/panel-feedback-mcp)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC.svg)](https://code.visualstudio.com/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![Windsurf](https://img.shields.io/badge/Windsurf-Compatible-green.svg)](https://codeium.com/windsurf)

> **下一代 AI 反馈体验 - 嵌入式 IDE 面板**
> 
> *告别弹窗，专注流程。*

🚫 **厌倦了弹窗打断你的编码思路？**  
🚫 **讨厌对话框抢占你的焦点？**  
🚫 **频繁切换上下文影响你的效率？**

**Panel Feedback** 完美解决这些问题，将 AI 交互直接嵌入 IDE 侧边栏 - 无缝集成，随时可用，永不打扰。

作为 [寸止](https://github.com/imhuso/cunzhi) 的进化版本，Panel Feedback 采用**非侵入式的内嵌面板**，让 AI 反馈体验更上一层楼。

### 🎯 适用人群
- 使用 **Claude** / **GPT** / **Gemini** 等支持 MCP 的 AI 用户
- **VS Code** / **Windsurf** / **Cursor** 开发者
- 追求**不被打断的工作流**的所有人

[English](./README.md)

## ✨ 为什么选择 Panel Feedback？

| 特性 | Panel Feedback | 传统弹窗 |
|-----|---------------|---------|
| **位置** | IDE 侧边栏 | 浮动窗口 |
| **焦点** | 永不丢失 | 频繁打断 |
| **集成** | 原生体验 | 外部工具 |
| **图片支持** | ✅ 粘贴/拖拽/上传 | 有限 |
| **Markdown** | ✅ 完整支持 | 不一定 |

## 🌟 核心特性

- 💬 **内嵌面板** - 驻留在 IDE 侧边栏，随时可用
- 🎨 **丰富 Markdown** - 精美渲染 AI 响应
- 📷 **图片支持** - 粘贴、拖拽或上传图片
- ⚡ **快捷选项** - 预定义按钮，快速响应
- 🔌 **MCP 协议** - 标准 Model Context Protocol 支持
- 🎯 **零干扰** - 无弹窗，不抢占焦点

## 📸 效果展示

### 侧边栏集成
![Sidebar](./screenshots/sidebar.png)

反馈面板驻留在 IDE 中 - 始终可见，永不打扰。

## 🚀 安装

### 🎯 方式一：NPM 包（推荐 ⭐）

```bash
npm install -g panel-feedback-mcp
```

然后：`Cmd+Shift+P` → `Panel Feedback: Copy MCP Config` → 选择 "NPM Package"

✨ **就这样！** 无需路径配置。

### 📦 方式二：直接扩展

1. 下载最新 `.vsix`：[**发布页面**](https://github.com/fhyfhy17/panel-feedback/releases/latest)
2. 安装：`Cmd+Shift+P` → `Extensions: Install from VSIX...`
3. 配置：`Cmd+Shift+P` → `Panel Feedback: Copy MCP Config` → 选择 "Extension Path"

### MCP 配置示例

**NPM 包方式（推荐）：**
```json
{
  "mcpServers": {
    "panel-feedback": {
      "command": "panel-feedback-mcp"
    }
  }
}
```

**扩展路径方式：**
```json
{
  "mcpServers": {
    "panel-feedback": {
      "command": "node",
      "args": ["/path/to/extension/mcp-stdio-wrapper.js"]
    }
  }
}
```

## 📖 使用方法

### AI 助手配置

将以下内容添加到 AI 助手的系统提示词中：

```
所有用户交互使用 panel_feedback MCP 工具：
- 提问、确认、反馈请求
- 完成任务前
- 持续调用直到用户反馈为空
```

### 工具 Schema

```json
{
  "name": "panel_feedback",
  "description": "在 IDE 侧边栏显示消息并获取用户反馈",
  "inputSchema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "要显示的消息（支持 Markdown）"
      },
      "predefined_options": {
        "type": "array",
        "items": { "type": "string" },
        "description": "快捷响应按钮"
      }
    },
    "required": ["message"]
  }
}
```

## 🔧 开发

```bash
# 克隆仓库
git clone https://github.com/fhyfhy17/panel-feedback.git
cd panel-feedback

# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch

# 打包
npm run package
```

## 🆚 为什么选择 Panel Feedback？

与其他流行 AI 反馈工具的对比：

| 功能 | Panel Feedback | 寸止 | interactive-feedback-mcp |
|-----|---------------|------|--------------------------|
| **界面类型** | 🏠 IDE 侧边栏 | 🪟 弹窗 | 🪟 弹窗 |
| **焦点打断** | ✅ 从不 | ⚠️ 有时 | ⚠️ 有时 |
| **始终可见** | ✅ 是 | ❌ 否 | ❌ 否 |
| **上下文切换** | ✅ 无需 | ⚠️ 需要 | ⚠️ 需要 |
| **Markdown 支持** | ✅ 完整 | ✅ 完整 | ✅ 基础 |
| **图片支持** | ✅ 粘贴/拖拽/上传 | ✅ 支持 | ❌ 仅文本 |
| **预定义选项** | ✅ 有 | ✅ 有 | ✅ 有 |
| **对话历史** | ✅ 有 | ❌ 无 | ❌ 无 |
| **平台** | VS Code/Windsurf/Cursor | 独立应用 | Python GUI |
| **安装方式** | 扩展安装 | 下载二进制 | pip install |

### 💡 核心优势

1. **零干扰** - 编码时不会有弹窗抢占焦点
2. **随时可用** - 面板始终在侧边栏可见，需要时即可使用
3. **原生集成** - 感觉像 IDE 内置功能，而非外部工具
4. **富媒体支持** - 完整的图片支持：粘贴、拖拽、上传
5. **对话上下文** - 查看之前的消息，不丢失上下文

## 🤝 参与贡献

欢迎贡献！你可以：

- 🐛 报告 Bug
- 💡 建议新功能
- 🔧 提交 Pull Request

## 📄 开源协议

MIT License - 自由使用和修改！

## 🙏 致谢

- [寸止](https://github.com/imhuso/cunzhi) - AI 反馈工具的原始灵感来源
- [interactive-feedback-mcp](https://github.com/noopstudios/interactive-feedback-mcp) - MCP 反馈实现参考

## 🏷️ 关键词

`MCP` `Model Context Protocol` `AI 反馈` `VS Code 扩展` `Windsurf` `Cursor` `Claude` `GPT` `AI 助手` `开发者工具` `IDE 扩展` `非侵入式` `侧边栏面板` `Markdown` `图片上传`

---

**用 ❤️ 打造更好的 AI-人类协作**

⭐ **如果觉得有用，请给个 Star！**
