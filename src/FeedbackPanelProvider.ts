import * as vscode from 'vscode';
import * as path from 'path';

interface ChatMessage {
    role: 'ai' | 'user';
    content: string;
    timestamp: number;
    images?: string[];
}

export class FeedbackPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'feedbackPanel.view';
    
    private _view?: vscode.WebviewView;
    private _editorPanel?: vscode.WebviewPanel;
    private _pendingResolve?: (value: string) => void;
    private _currentMessage: string = '';
    private _currentOptions: string[] = [];
    private _currentRequestId?: string;
    private _chatHistory: ChatMessage[] = [];
    private _rules: string = '';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 监听来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'submit':
                    this._handleSubmit(data.value, data.images);
                    break;
                case 'optionSelected':
                    this._handleSubmit(data.value, []);
                    break;
                case 'clearHistory':
                    this.clearHistory();
                    break;
                case 'fixedAction':
                    this._handleFixedAction(data.action, data.text);
                    break;
                case 'loadRules':
                    this._loadRules();
                    break;
                case 'saveRules':
                    this._saveRules(data.rules);
                    break;
                case 'getVersion':
                    this._sendVersionInfo();
                    break;
                case 'checkUpdate':
                    this._checkForUpdates();
                    break;
            }
        });
    }

    private _sendVersionInfo() {
        const ext = vscode.extensions.getExtension('fhyfhy17.windsurf-feedback-panel');
        const version = ext?.packageJSON.version || 'unknown';
        this._view?.webview.postMessage({ type: 'versionInfo', version });
    }

    private _checkForUpdates() {
        const ext = vscode.extensions.getExtension('fhyfhy17.windsurf-feedback-panel');
        const currentVersion = ext?.packageJSON.version || '0.0.0';
        const isZh = vscode.env.language.startsWith('zh');
        
        const https = require('https');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        const options = {
            hostname: 'api.github.com',
            path: '/repos/fhyfhy17/panel-feedback/releases/latest',
            headers: { 'User-Agent': 'VSCode-Extension' }
        };
        
        https.get(options, (res: any) => {
            let data = '';
            res.on('data', (chunk: string) => data += chunk);
            res.on('end', () => {
                try {
                    const release = JSON.parse(data);
                    const latestVersion = release.tag_name?.replace('v', '') || '';
                    const hasUpdate = this._compareVersions(latestVersion, currentVersion) > 0;
                    
                    // Find vsix asset
                    const vsixAsset = release.assets?.find((a: any) => a.name.endsWith('.vsix'));
                    
                    this._view?.webview.postMessage({ 
                        type: 'updateResult', 
                        hasUpdate, 
                        latestVersion,
                        downloadUrl: release.html_url 
                    });
                    
                    if (hasUpdate && vsixAsset) {
                        const msg = isZh 
                            ? `🎉 Panel Feedback v${latestVersion} 可用！` 
                            : `🎉 Panel Feedback v${latestVersion} is available!`;
                        const installBtn = isZh ? '下载并安装' : 'Install';
                        const laterBtn = isZh ? '稍后' : 'Later';
                        
                        vscode.window.showInformationMessage(msg, installBtn, laterBtn)
                        .then(action => {
                            if (action === installBtn) {
                                this._downloadAndInstall(vsixAsset.browser_download_url, latestVersion, isZh);
                            }
                        });
                    } else if (hasUpdate) {
                        // No vsix asset, just open release page
                        vscode.env.openExternal(vscode.Uri.parse(release.html_url));
                    }
                } catch (e) {
                    this._view?.webview.postMessage({ type: 'updateResult', hasUpdate: false });
                }
            });
        }).on('error', () => {
            this._view?.webview.postMessage({ type: 'updateResult', hasUpdate: false });
        });
    }

    private _downloadAndInstall(url: string, version: string, isZh: boolean) {
        const https = require('https');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        const tmpDir = os.tmpdir();
        const vsixPath = path.join(tmpDir, `windsurf-feedback-panel-${version}.vsix`);
        
        const downloadMsg = isZh ? '正在下载更新...' : 'Downloading update...';
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: downloadMsg,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const file = fs.createWriteStream(vsixPath);
                
                // Follow redirects
                const download = (downloadUrl: string) => {
                    https.get(downloadUrl, { headers: { 'User-Agent': 'VSCode-Extension' } }, (res: any) => {
                        if (res.statusCode === 302 || res.statusCode === 301) {
                            download(res.headers.location);
                            return;
                        }
                        
                        res.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            resolve();
                        });
                    }).on('error', (err: Error) => {
                        fs.unlink(vsixPath, () => {});
                        reject(err);
                    });
                };
                
                download(url);
            });
        }).then(() => {
            const successMsg = isZh 
                ? `下载完成！是否立即安装 v${version}？` 
                : `Download complete! Install v${version} now?`;
            const installBtn = isZh ? '安装并重启' : 'Install & Reload';
            const cancelBtn = isZh ? '取消' : 'Cancel';
            
            vscode.window.showInformationMessage(successMsg, installBtn, cancelBtn)
            .then(action => {
                if (action === installBtn) {
                    vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath))
                    .then(() => {
                        const reloadMsg = isZh ? '安装成功！是否重新加载窗口？' : 'Installed! Reload window?';
                        const reloadBtn = isZh ? '重新加载' : 'Reload';
                        vscode.window.showInformationMessage(reloadMsg, reloadBtn)
                        .then(action => {
                            if (action === reloadBtn) {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });
                    });
                }
            });
        }, () => {
            const errMsg = isZh ? '下载失败，请手动下载' : 'Download failed, please download manually';
            vscode.window.showErrorMessage(errMsg);
        });
    }

    private _compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    private _handleSubmit(text: string, images: string[]) {
        if (this._pendingResolve) {
            // 记录用户回复到历史（显示原始内容）
            this._chatHistory.push({
                role: 'user',
                content: text,
                timestamp: Date.now(),
                images: images.length > 0 ? images : undefined
            });
            this._updateHistoryInView();
            
            // 附加 rules 后发送给 AI
            const finalText = this._appendRules(text);
            const result = images.length > 0 
                ? JSON.stringify({ text: finalText, images })
                : finalText;
            this._pendingResolve(result);
            this._pendingResolve = undefined;
        }
    }

    private _handleFixedAction(action: string, text: string) {
        // 固定操作直接作为用户输入提交
        if (this._pendingResolve) {
            const finalText = this._appendRules(text);
            this._chatHistory.push({
                role: 'user',
                content: text,
                timestamp: Date.now()
            });
            this._updateHistoryInView();
            this._pendingResolve(finalText);
            this._pendingResolve = undefined;
        }
    }

    private _appendRules(text: string): string {
        if (this._rules) {
            return `${text}\n\n---\n[Rules/Memory]:\n${this._rules}`;
        }
        return text;
    }

    private _loadRules() {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const rulesFile = path.join(os.homedir(), '.panel-feedback', 'rules.txt');
        
        try {
            if (fs.existsSync(rulesFile)) {
                this._rules = fs.readFileSync(rulesFile, 'utf-8');
            }
        } catch (e) {
            console.error('Failed to load rules:', e);
        }
        
        const msgData = { type: 'rulesLoaded', rules: this._rules };
        this._view?.webview.postMessage(msgData);
        this._editorPanel?.webview.postMessage(msgData);
    }

    private _saveRules(rules: string) {
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const rulesDir = path.join(os.homedir(), '.panel-feedback');
        const rulesFile = path.join(rulesDir, 'rules.txt');
        
        try {
            if (!fs.existsSync(rulesDir)) {
                fs.mkdirSync(rulesDir, { recursive: true });
            }
            fs.writeFileSync(rulesFile, rules, 'utf-8');
            this._rules = rules;
        } catch (e) {
            console.error('Failed to save rules:', e);
        }
    }
    
    private _updateHistoryInView() {
        const msgData = {
            type: 'updateHistory',
            history: this._chatHistory
        };
        if (this._view) {
            this._view.webview.postMessage(msgData);
        }
        if (this._editorPanel) {
            this._editorPanel.webview.postMessage(msgData);
        }
    }
    
    public clearHistory() {
        this._chatHistory = [];
        this._updateHistoryInView();
    }

    public openSettings() {
        const msgData = { type: 'openSettings' };
        if (this._editorPanel?.visible) {
            this._editorPanel.webview.postMessage(msgData);
        } else if (this._view) {
            this._view.webview.postMessage(msgData);
        }
    }

    public async showMessage(message: string, options?: string[], requestId?: string): Promise<string> {
        this._currentMessage = message;
        this._currentOptions = options || [];
        this._currentRequestId = requestId;

        // 记录 AI 消息到历史
        this._chatHistory.push({
            role: 'ai',
            content: message,
            timestamp: Date.now()
        });

        const msgData = {
            type: 'showMessage',
            message: message,
            options: options || [],
            history: this._chatHistory
        };

        // 优先使用编辑器面板
        if (this._editorPanel) {
            this._editorPanel.reveal();
            this._editorPanel.webview.postMessage(msgData);
        } else {
            // 如果 webview 未初始化，先打开面板
            if (!this._view) {
                await vscode.commands.executeCommand('feedbackPanel.view.focus');
                // 等待 webview 初始化
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (this._view) {
                // false = 不保留焦点，让面板获得焦点
                this._view.show?.(false);
                this._view.webview.postMessage(msgData);
            }
        }

        return new Promise((resolve) => {
            this._pendingResolve = resolve;
        });
    }

    public submitFeedback() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'triggerSubmit' });
        }
        if (this._editorPanel) {
            this._editorPanel.webview.postMessage({ type: 'triggerSubmit' });
        }
    }

    public openInEditor(context: vscode.ExtensionContext) {
        // 如果已经打开，直接显示
        if (this._editorPanel) {
            this._editorPanel.reveal();
            return;
        }

        // 创建新的 WebviewPanel
        this._editorPanel = vscode.window.createWebviewPanel(
            'feedbackPanel.editor',
            '💬 Panel Feedback',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._editorPanel.webview.html = this._getHtmlForWebview(this._editorPanel.webview);

        // 监听消息
        this._editorPanel.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'submit':
                    this._handleSubmit(data.value, data.images);
                    break;
                case 'optionSelected':
                    this._handleSubmit(data.value, []);
                    break;
                case 'clearHistory':
                    this.clearHistory();
                    break;
                case 'fixedAction':
                    this._handleFixedAction(data.action, data.text);
                    break;
                case 'loadRules':
                    this._loadRules();
                    break;
                case 'saveRules':
                    this._saveRules(data.rules);
                    break;
            }
        }, undefined, context.subscriptions);

        // 监听关闭事件
        this._editorPanel.onDidDispose(() => {
            this._editorPanel = undefined;
        }, undefined, context.subscriptions);

        // 同步当前状态
        if (this._chatHistory.length > 0) {
            this._editorPanel.webview.postMessage({
                type: 'showMessage',
                message: this._currentMessage,
                options: this._currentOptions,
                history: this._chatHistory
            });
        }
    }

    // 获取当前活跃的 webview
    private _getActiveWebview(): vscode.Webview | undefined {
        if (this._editorPanel?.visible) {
            return this._editorPanel.webview;
        }
        return this._view?.webview;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Feedback</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 12px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .chat-container {
            margin-bottom: 12px;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .chat-bubble {
            max-width: 90%;
            padding: 10px 14px;
            border-radius: 12px;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .chat-bubble.ai {
            align-self: flex-start;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-bottom-left-radius: 4px;
        }
        .chat-bubble.user {
            align-self: flex-end;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-bottom-right-radius: 4px;
        }
        .chat-bubble .timestamp {
            font-size: 10px;
            opacity: 0.6;
            margin-top: 4px;
        }
        .chat-bubble .user-images {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 6px;
        }
        .chat-bubble .user-images img {
            max-width: 60px;
            max-height: 60px;
            border-radius: 4px;
        }
        .message {
            line-height: 1.6;
            white-space: pre-wrap;
        }
        .message h1, .message h2, .message h3 {
            margin: 8px 0;
            color: var(--vscode-textLink-foreground);
        }
        .message code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        .message pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .settings-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 200;
            justify-content: center;
            align-items: center;
        }
        .settings-modal.show {
            display: flex;
        }
        .settings-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 16px;
            width: 90%;
            max-width: 360px;
            max-height: 85%;
            overflow-y: auto;
        }
        .settings-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .settings-close {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.7;
        }
        .settings-close:hover {
            opacity: 1;
        }
        .settings-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 8px;
        }
        .settings-tab {
            padding: 6px 12px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        .settings-tab:hover {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-foreground);
        }
        .settings-tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .settings-tab-content {
            min-height: 120px;
        }
        .settings-tab-content.hidden {
            display: none;
        }
        .settings-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        .settings-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 0;
            font-size: 12px;
        }
        .settings-version {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        .settings-action {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
            margin-top: 6px;
            font-size: 12px;
        }
        .settings-action:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .rules-textarea {
            width: 100%;
            min-height: 100px;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
            font-size: 11px;
            margin-bottom: 4px;
        }
        .rules-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .current-question {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-focusBorder);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
            position: relative;
        }
        .current-question .label {
            font-size: 11px;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 6px;
            font-weight: 500;
        }
        .copy-btn {
            position: absolute;
            bottom: 8px;
            right: 8px;
            padding: 4px 6px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.6;
            transition: opacity 0.2s;
        }
        .copy-btn:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryBackground);
        }
        .copy-btn.copied {
            color: var(--vscode-testing-iconPassed);
            border-color: var(--vscode-testing-iconPassed);
        }
        .rules-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 200;
            justify-content: center;
            align-items: center;
        }
        .rules-modal.show {
            display: flex;
        }
        .rules-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 16px;
            width: 90%;
            max-width: 400px;
            max-height: 80%;
            display: flex;
            flex-direction: column;
        }
        .rules-title {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .rules-close {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.7;
        }
        .rules-close:hover {
            opacity: 1;
        }
        .rules-textarea {
            width: 100%;
            min-height: 150px;
            padding: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
            font-size: 12px;
            margin-bottom: 12px;
        }
        .rules-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .rules-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
        .rules-save {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            align-self: flex-end;
        }
        .rules-save:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .options-container {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 12px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
        }
        .options-title {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        .option-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            text-align: left;
            transition: all 0.15s;
        }
        .option-btn:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }
        .option-btn .option-key {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .option-btn .option-text {
            flex: 1;
        }
        .fixed-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px dashed var(--vscode-widget-border);
        }
        .fixed-action-btn {
            padding: 4px 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .fixed-action-btn:hover {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transform: scale(1.02);
        }
        .input-area {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .image-preview {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 8px;
        }
        .image-preview img {
            max-width: 100px;
            max-height: 80px;
            border-radius: 4px;
            cursor: pointer;
        }
        .image-preview .remove-btn {
            position: absolute;
            top: -6px;
            right: -6px;
            width: 18px;
            height: 18px;
            background: var(--vscode-errorForeground);
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
        }
        .image-item {
            position: relative;
            display: inline-block;
        }
        textarea {
            width: 100%;
            min-height: 80px;
            padding: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
            font-size: inherit;
        }
        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .toolbar {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .toolbar-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .toolbar-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .submit-btn {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            margin-left: auto;
        }
        .submit-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }
        .empty-state svg {
            width: 48px;
            height: 48px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        #dropZone {
            border: 2px dashed var(--vscode-widget-border);
            border-radius: 4px;
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            display: none;
        }
        #dropZone.active {
            display: block;
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-editor-selectionBackground);
        }
        .hidden { display: none !important; }
        
        /* 新消息高亮样式 - 1.5秒蓝色闪烁效果 */
        .current-question.new-message {
            animation: flashHighlight 1.5s ease-out;
        }
        
        @keyframes flashHighlight {
            0% { 
                background: rgba(33, 150, 243, 0.15);
                border-left: 3px solid #2196F3;
                transform: scale(1.01);
            }
            50% { 
                background: rgba(33, 150, 243, 0.1);
                border-left: 3px solid #2196F3;
            }
            100% { 
                background: var(--vscode-editor-background);
                border-left: 3px solid transparent;
                transform: scale(1);
            }
        }
    </style>
</head>
<body>
    <div id="settingsModal" class="settings-modal">
        <div class="settings-content">
            <div class="settings-title">
                <span>⚙️ 设置</span>
                <button class="settings-close" id="closeSettings">×</button>
            </div>
            
            <div class="settings-tabs">
                <button class="settings-tab active" data-tab="rules">📝 Rules</button>
                <button class="settings-tab" data-tab="actions">⚡ 快捷操作</button>
            </div>
            
            <div class="settings-tab-content" id="tab-rules">
                <div class="settings-hint">每次提交反馈时会自动附加这些内容给 AI</div>
                <textarea id="rulesTextarea" class="rules-textarea" placeholder="例如：&#10;- 使用中文回复&#10;- 代码要有注释&#10;- 修改前先确认"></textarea>
                <button class="settings-action" id="saveRules">💾 保存</button>
            </div>
            
            <div class="settings-tab-content hidden" id="tab-actions">
                <div class="settings-hint">管理固定的快捷操作按钮（开发中）</div>
            </div>
        </div>
    </div>

    <div id="emptyState" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>Waiting for AI...</p>
    </div>

    <div id="feedbackArea" class="hidden" style="position: relative; display: flex; flex-direction: column; height: 100%; overflow-y: auto;">
        <!-- 历史对话区域 -->
        <div id="chatHistory" class="chat-container"></div>
        
        <!-- 当前问题区域 -->
        <div id="currentQuestion" class="current-question">
            <button id="copyBtn" class="copy-btn" title="Copy">📋</button>
            <div class="label">🤖 AI</div>
            <div id="messageContent" class="message"></div>
        </div>
        
        <!-- 固定操作按钮 -->
        <div class="fixed-actions" id="fixedActions" style="display: none;">
            <button class="fixed-action-btn" data-action="commitAndPush" title="提交挂起的更改并推送到远程分支">🚀 提交并推送</button>
            <button class="fixed-action-btn" data-action="codeReview" title="审查当前更改的代码">🔍 代码审查</button>
            <button class="fixed-action-btn" data-action="formatCode" title="整理代码格式和排序">📐 整理格式</button>
        </div>
        
        <div id="optionsContainer" class="options-container"></div>
        
        <div id="dropZone">
            📎 拖拽图片或文件/文件夹到这里
        </div>

        <div class="input-area">
            <div id="imagePreview" class="image-preview"></div>
            <textarea 
                id="feedbackInput" 
                placeholder="Type your feedback, paste image (Ctrl+V)..."
            ></textarea>
            <div class="toolbar">
                <button class="submit-btn" id="submitBtn">Submit</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        const emptyState = document.getElementById('emptyState');
        const feedbackArea = document.getElementById('feedbackArea');
        const messageContent = document.getElementById('messageContent');
        const optionsContainer = document.getElementById('optionsContainer');
        const feedbackInput = document.getElementById('feedbackInput');
        const imagePreview = document.getElementById('imagePreview');
        const submitBtn = document.getElementById('submitBtn');
                        const dropZone = document.getElementById('dropZone');
        const chatHistory = document.getElementById('chatHistory');
        const currentQuestion = document.getElementById('currentQuestion');
        const fixedActions = document.getElementById('fixedActions');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettings = document.getElementById('closeSettings');
        const rulesTextarea = document.getElementById('rulesTextarea');
        const saveRules = document.getElementById('saveRules');
        const settingsTabs = document.querySelectorAll('.settings-tab');

        let images = [];
        let historyData = [];
        let currentRules = '';
        
        // 固定操作映射
        const fixedActionTexts = {
            'commitAndPush': '提交挂起的更改并推送到远程分支',
            'codeReview': '审查当前更改的代码，检查潜在问题和改进建议',
            'formatCode': '整理当前文件的代码格式：1. 按执行顺序排列代码 2. 相同类型的代码归类在一起（如常量、变量、函数、类等）3. 清除没有引用的代码 4. 所有对象引用都使用 using 语句 5. 保持逻辑清晰的代码结构'
        };
        
        // 加载已保存的 rules
        vscode.postMessage({ type: 'loadRules' });
        
        // 固定操作按钮事件（使用事件委托）
        fixedActions.addEventListener('click', (e) => {
            const btn = e.target.closest('.fixed-action-btn');
            if (btn) {
                const action = btn.dataset.action;
                const text = fixedActionTexts[action] || action;
                // 和选项点击保持一致：添加到历史并显示等待状态
                addUserReplyToHistory(text, []);
                vscode.postMessage({ 
                    type: 'fixedAction', 
                    action: action,
                    text: text
                });
                showWaitingState();
            }
        });
        
        // 设置弹窗事件
        closeSettings.addEventListener('click', () => {
            settingsModal.classList.remove('show');
        });
        
        // Tab 切换
        settingsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                settingsTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
                document.getElementById('tab-' + tabName).classList.remove('hidden');
            });
        });
        
        saveRules.addEventListener('click', () => {
            currentRules = rulesTextarea.value.trim();
            vscode.postMessage({ type: 'saveRules', rules: currentRules });
            saveRules.textContent = '✅ 已保存';
            setTimeout(() => {
                saveRules.textContent = '💾 保存';
            }, 1500);
        });
        
        // 1秒闪烁效果
        function showNewMessageHighlight() {
            const question = document.getElementById('currentQuestion');
            if (!question) return;
            
            // 移除后重新添加以重新触发动画
            question.classList.remove('new-message');
            void question.offsetWidth; // 触发 reflow
            question.classList.add('new-message');
            
            // 1.5秒后移除 class
            setTimeout(() => {
                question.classList.remove('new-message');
            }, 1500);
        }

        // 简单的 Markdown 渲染
        function renderMarkdown(text) {
            return text
                .replace(/^### (.*$)/gm, '<h3>$1</h3>')
                .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
                .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/^- (.*$)/gm, '• $1')
                .replace(/\\n/g, '<br>');
        }

        // 格式化时间
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        // 渲染历史对话
        // showAll: true 时显示全部历史（等待状态用）
        function renderHistory(history, showAll = false) {
            // 正常情况：最后一条是当前 AI 问题，不在历史里显示
            // 等待状态：显示全部（包括刚提交的用户回复）
            const historyToShow = showAll ? history : history.slice(0, -1);
            
            chatHistory.innerHTML = '';
            
            if (historyToShow.length === 0) {
                chatHistory.style.display = 'none';
                return;
            }
            
            chatHistory.style.display = 'flex';
            
            historyToShow.forEach(msg => {
                const bubble = document.createElement('div');
                bubble.className = 'chat-bubble ' + msg.role;
                
                let content = '';
                if (msg.role === 'ai') {
                    content = '<div class="message">' + renderMarkdown(msg.content) + '</div>';
                } else {
                    content = '<div>' + (msg.content || '<em>(empty)</em>') + '</div>';
                    if (msg.images && msg.images.length > 0) {
                        content += '<div class="user-images">';
                        msg.images.forEach(img => {
                            content += '<img src="' + img + '">';
                        });
                        content += '</div>';
                    }
                }
                content += '<div class="timestamp">' + formatTime(msg.timestamp) + '</div>';
                
                bubble.innerHTML = content;
                chatHistory.appendChild(bubble);
            });
            
            // 滚动到底部
            scrollToBottom();
        }
        
        function scrollToBottom() {
            setTimeout(() => {
                feedbackArea.scrollTop = feedbackArea.scrollHeight;
                // 自动聚焦输入框
                feedbackInput.focus();
            }, 50);
        }

        // 显示消息
        function showMessage(message, options, history) {
            emptyState.classList.add('hidden');
            feedbackArea.classList.remove('hidden');
            
            // 隐藏等待提示
            const waitingDiv = document.getElementById('waitingHint');
            if (waitingDiv) waitingDiv.style.display = 'none';
            
            // 显示当前问题和输入区
            currentQuestion.style.display = 'block';
            document.querySelector('.input-area').style.display = 'flex';
            fixedActions.style.display = 'flex';  // 显示固定操作
            
            // 渲染历史
            if (history && history.length > 0) {
                historyData = history;
                renderHistory(history);
            }
            
            messageContent.innerHTML = renderMarkdown(message);
            
            // 显示1秒闪烁效果
            showNewMessageHighlight();
            
            // 滚动到底部
            scrollToBottom();
            
            // 渲染选项按钮
            optionsContainer.innerHTML = '';
            if (options && options.length > 0) {
                const title = document.createElement('div');
                title.className = 'options-title';
                title.textContent = '选择一个选项：';
                optionsContainer.appendChild(title);
                
                options.forEach((opt, idx) => {
                    const btn = document.createElement('button');
                    btn.className = 'option-btn';
                    const keyLabel = String.fromCharCode(65 + idx); // A, B, C...
                    btn.innerHTML = '<span class="option-key">' + keyLabel + '</span><span class="option-text">' + opt + '</span>';
                    btn.onclick = () => selectOption(opt);
                    optionsContainer.appendChild(btn);
                });
                optionsContainer.style.display = 'flex';
            } else {
                optionsContainer.style.display = 'none';
            }
            
            feedbackInput.value = '';
            images = [];
            updateImagePreview();
        }

        // 选择选项
        function selectOption(value) {
            // 先添加用户回复到本地历史
            addUserReplyToHistory(value, []);
            vscode.postMessage({ type: 'optionSelected', value });
            showWaitingState();
        }

        // 提交反馈
        function submit() {
            const text = feedbackInput.value.trim();
            const currentImages = [...images];
            
            // 先添加用户回复到本地历史
            addUserReplyToHistory(text, currentImages);
            
            vscode.postMessage({ 
                type: 'submit', 
                value: text,
                images: currentImages 
            });
            showWaitingState();
        }
        
        // 添加用户回复到本地历史
        function addUserReplyToHistory(text, imgs) {
            historyData.push({
                role: 'user',
                content: text,
                timestamp: Date.now(),
                images: imgs.length > 0 ? imgs : undefined
            });
            // 等待状态时显示完整历史
            renderHistory(historyData, true);
        }

        // 显示等待状态（保留历史，隐藏当前问题）
        function showWaitingState() {
            feedbackInput.value = '';
            images = [];
            updateImagePreview();
            
            // 隐藏当前问题和输入区，但保留历史
            currentQuestion.style.display = 'none';
            optionsContainer.innerHTML = '';
            optionsContainer.style.display = 'none';
            document.querySelector('.input-area').style.display = 'none';
            fixedActions.style.display = 'none';  // 隐藏固定操作
            
            // 如果没有历史，则显示空状态
            if (historyData.length <= 1) {
                emptyState.classList.remove('hidden');
                feedbackArea.classList.add('hidden');
            } else {
                // 显示等待提示
                const waitingDiv = document.getElementById('waitingHint') || createWaitingHint();
                waitingDiv.style.display = 'block';
            }
        }
        
        function createWaitingHint() {
            const div = document.createElement('div');
            div.id = 'waitingHint';
            div.style.cssText = 'text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); font-size: 13px;';
            div.innerHTML = '⏳ Waiting for AI...';
            feedbackArea.appendChild(div);
            return div;
        }

        function resetToEmpty() {
            emptyState.classList.remove('hidden');
            feedbackArea.classList.add('hidden');
            feedbackInput.value = '';
            images = [];
            updateImagePreview();
        }

        // 图片处理
        function addImage(dataUrl) {
            images.push(dataUrl);
            updateImagePreview();
        }

        function removeImage(index) {
            images.splice(index, 1);
            updateImagePreview();
        }

        function updateImagePreview() {
            imagePreview.innerHTML = '';
            images.forEach((img, idx) => {
                const item = document.createElement('div');
                item.className = 'image-item';
                item.innerHTML = \`
                    <img src="\${img}" onclick="window.open('\${img}')">
                    <button class="remove-btn" onclick="removeImage(\${idx})">×</button>
                \`;
                imagePreview.appendChild(item);
            });
        }

        // 粘贴处理
        document.addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = () => addImage(reader.result);
                    reader.readAsDataURL(file);
                }
            }
        });

        // 拖拽处理 - 只有拖拽图片时才显示提示区域
        let dragHasImage = false;
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            // 检查是否包含图片
            const types = e.dataTransfer?.types || [];
            const items = e.dataTransfer?.items;
            dragHasImage = false;
            
            if (items) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.startsWith('image/')) {
                        dragHasImage = true;
                        break;
                    }
                }
            }
            
            // 只有图片才显示拖拽区域
            if (dragHasImage) {
                dropZone.classList.add('active');
            }
        });

        document.addEventListener('dragleave', () => {
            dropZone.classList.remove('active');
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('active');
            
            const files = e.dataTransfer?.files;
            const items = e.dataTransfer?.items;
            
            // 调试：打印拖拽数据
            console.log('Drop event:', {
                filesCount: files?.length,
                itemsCount: items?.length,
                types: e.dataTransfer?.types
            });
            
            // 尝试获取 text/uri-list（VS Code 资源管理器拖拽）
            const uriList = e.dataTransfer?.getData('text/uri-list');
            const textPlain = e.dataTransfer?.getData('text/plain');
            console.log('URI List:', uriList);
            console.log('Text Plain:', textPlain);
            
            // 优先使用 URI list
            if (uriList) {
                const paths = uriList.split('\\n')
                    .filter(uri => uri.trim())
                    .map(uri => {
                        // 转换 file:// URI 为路径
                        if (uri.startsWith('file://')) {
                            return decodeURIComponent(uri.replace('file:///', '').replace('file://', ''));
                        }
                        return uri;
                    });
                
                if (paths.length > 0) {
                    const pathText = paths.map(p => '\`' + p + '\`').join(' ');
                    const currentText = feedbackInput.value;
                    const cursorPos = feedbackInput.selectionStart;
                    const before = currentText.substring(0, cursorPos);
                    const after = currentText.substring(cursorPos);
                    feedbackInput.value = before + pathText + after;
                    feedbackInput.focus();
                    feedbackInput.selectionStart = feedbackInput.selectionEnd = cursorPos + pathText.length;
                    return;
                }
            }
            
            // 回退：处理文件
            if (files && files.length > 0) {
                const paths = [];
                let hasImage = false;
                
                Array.from(files).forEach(file => {
                    console.log('File:', { name: file.name, type: file.type, path: file.path });
                    
                    if (file.type.startsWith('image/')) {
                        hasImage = true;
                        const reader = new FileReader();
                        reader.onload = () => addImage(reader.result);
                        reader.readAsDataURL(file);
                    } else if (file.path) {
                        paths.push(file.path);
                    } else if (file.name) {
                        paths.push(file.name);
                    }
                });
                
                if (paths.length > 0 && !hasImage) {
                    const pathText = paths.map(p => '\`' + p + '\`').join(' ');
                    const currentText = feedbackInput.value;
                    const cursorPos = feedbackInput.selectionStart;
                    const before = currentText.substring(0, cursorPos);
                    const after = currentText.substring(cursorPos);
                    feedbackInput.value = before + pathText + after;
                    feedbackInput.focus();
                    feedbackInput.selectionStart = feedbackInput.selectionEnd = cursorPos + pathText.length;
                }
            }
        });

        // 提交按钮
        submitBtn.onclick = submit;

        // 快捷键：回车发送，Cmd+回车换行
        feedbackInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey) {
                    // Cmd+回车 = 换行，不阻止默认行为
                    return;
                }
                // 回车 = 发送
                e.preventDefault();
                submit();
            }
        });

        // 复制按钮
        const copyBtn = document.getElementById('copyBtn');
        copyBtn.onclick = () => {
            const content = messageContent.innerText || messageContent.textContent;
            navigator.clipboard.writeText(content).then(() => {
                copyBtn.textContent = '✓';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = '📋';
                    copyBtn.classList.remove('copied');
                }, 1500);
            });
        };

        // 点击弹窗外部关闭
        settingsModal.onclick = (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('show');
            }
        };

        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const data = event.data;
            switch (data.type) {
                case 'showMessage':
                    showMessage(data.message, data.options, data.history);
                    break;
                case 'triggerSubmit':
                    submit();
                    break;
                case 'updateHistory':
                    historyData = data.history || [];
                    // 更新历史时显示全部（包括最新用户回复）
                    renderHistory(historyData, true);
                    break;
                case 'openSettings':
                    rulesTextarea.value = currentRules;
                    settingsModal.classList.add('show');
                    break;
                case 'rulesLoaded':
                    currentRules = data.rules || '';
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
