import * as vscode from 'vscode';
import * as path from 'path';

interface ChatMessage {
    role: 'ai' | 'user';
    content: string;
    timestamp: number;
    images?: string[];
}

interface InputHistoryItem {
    text: string;
    timestamp: number;
    pinned: boolean;
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
    private _workspaceHash: string = '';  // 工作空间哈希值
    private _workspaceName: string = '';  // 工作空间名称
    private _onEndConversation?: () => void;  // 结束对话回调
    private _inputHistory: InputHistoryItem[] = [];  // 输入历史记录
    private static readonly MAX_INPUT_HISTORY = 10;  // 最大历史记录数

    constructor(private readonly _extensionUri: vscode.Uri) {
        // 生成工作空间哈希值
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this._workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || '';
        if (workspacePath) {
            const crypto = require('crypto');
            const hash = crypto.createHash('md5').update(workspacePath).digest('hex');
            this._workspaceHash = hash.substring(0, 8);
        }
    }

    private _extensionContext?: vscode.ExtensionContext;

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

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, false);

        // 侧边栏视图变为可见时，自动打开 tab 页
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible && this._extensionContext) {
                this.openInEditor(this._extensionContext);
            }
        });

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
                case 'getWorkspaceInfo':
                    this._sendWorkspaceInfo();
                    break;
                case 'checkUpdate':
                    this._checkForUpdates();
                    break;
                case 'endConversation':
                    this._handleEndConversation();
                    break;
                case 'copyToClipboard':
                    vscode.env.clipboard.writeText(data.text);
                    break;
                case 'openLogFolder':
                    this._openLogFolder();
                    break;
                case 'selectFile':
                    this._handleSelectFile(data.selectType);
                    break;
                case 'getWorkspaceFiles':
                    this._handleGetWorkspaceFiles(data.query || '');
                    break;
                case 'openInEditor':
                    if (this._extensionContext) {
                        this.openInEditor(this._extensionContext);
                    }
                    break;
                case 'loadInputHistory':
                    this._loadInputHistory();
                    break;
                case 'addInputHistory':
                    this._addInputHistory(data.text);
                    break;
                case 'deleteInputHistory':
                    this._deleteInputHistory(data.index);
                    break;
                case 'togglePinInputHistory':
                    this._togglePinInputHistory(data.index);
                    break;
            }
        });
    }

    private _sendVersionInfo() {
        const ext = vscode.extensions.getExtension('fhyfhy17.windsurf-feedback-panel');
        const version = ext?.packageJSON.version || 'unknown';
        this._view?.webview.postMessage({ type: 'versionInfo', version });
    }

    private _openLogFolder() {
        const os = require('os');
        const path = require('path');
        const logDir = path.join(os.homedir(), '.panel-feedback');
        vscode.env.openExternal(vscode.Uri.file(logDir));
    }

    private async _handleSelectFile(selectType: 'file' | 'folder') {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            canSelectFolders: selectType === 'folder',
            canSelectFiles: selectType === 'file',
            defaultUri: workspaceFolder,
            title: selectType === 'file' ? '选择文件' : '选择文件夹'
        };
        
        const uris = await vscode.window.showOpenDialog(options);
        
        if (uris && uris.length > 0) {
            const paths = uris.map(uri => uri.fsPath);
            const msgData = { type: 'fileSelected', paths };
            this._view?.webview.postMessage(msgData);
            this._editorPanel?.webview.postMessage(msgData);
        }
    }

    private async _getWorkspaceFiles(query: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const excludePatterns = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.vscode/**', '**/build/**', '**/*.vsix', '**/screenshots/**'];
        
        try {
            // 增加文件数量限制以支持更多递归文件
            const files = await vscode.workspace.findFiles(
                '**/*',
                `{${excludePatterns.join(',')}}`,
                500
            );

            const workspacePath = workspaceFolder.uri.fsPath;
            const results: { name: string; relativePath: string; fullPath: string; isFolder: boolean; depth: number }[] = [];
            const folderSet = new Set<string>();

            for (const file of files) {
                const relativePath = path.relative(workspacePath, file.fsPath);
                const fileName = path.basename(file.fsPath);
                const depth = relativePath.split(path.sep).length;
                
                // 添加文件
                if (!query || fileName.toLowerCase().includes(query.toLowerCase()) || relativePath.toLowerCase().includes(query.toLowerCase())) {
                    results.push({
                        name: fileName,
                        relativePath: relativePath,
                        fullPath: file.fsPath,
                        isFolder: false,
                        depth: depth
                    });
                }

                // 收集所有层级的文件夹
                const dirPath = path.dirname(relativePath);
                if (dirPath && dirPath !== '.') {
                    const parts = dirPath.split(path.sep);
                    let currentPath = '';
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i];
                        currentPath = currentPath ? path.join(currentPath, part) : part;
                        if (!folderSet.has(currentPath)) {
                            folderSet.add(currentPath);
                            const folderName = path.basename(currentPath);
                            const folderDepth = i + 1;
                            if (!query || folderName.toLowerCase().includes(query.toLowerCase()) || currentPath.toLowerCase().includes(query.toLowerCase())) {
                                results.push({
                                    name: folderName,
                                    relativePath: currentPath,
                                    fullPath: path.join(workspacePath, currentPath),
                                    isFolder: true,
                                    depth: folderDepth
                                });
                            }
                        }
                    }
                }
            }

            // 去重并排序：先按深度，再按类型（文件夹优先），最后按路径
            const uniqueResults = Array.from(new Map(results.map(r => [r.fullPath, r])).values());
            uniqueResults.sort((a, b) => {
                // 先按深度排序（浅层优先）
                if (a.depth !== b.depth) return a.depth - b.depth;
                // 同深度下文件夹优先
                if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
                // 最后按路径字母顺序
                return a.relativePath.localeCompare(b.relativePath);
            });

            return uniqueResults.slice(0, 100);
        } catch (error) {
            console.error('Error getting workspace files:', error);
            return [];
        }
    }

    private async _handleGetWorkspaceFiles(query: string) {
        const files = await this._getWorkspaceFiles(query);
        const msgData = { type: 'workspaceFiles', files };
        this._view?.webview.postMessage(msgData);
        this._editorPanel?.webview.postMessage(msgData);
    }

    private _sendWorkspaceInfo() {
        const msgData = { 
            type: 'workspaceInfo', 
            workspaceHash: this._workspaceHash,
            workspaceName: this._workspaceName
        };
        this._view?.webview.postMessage(msgData);
        this._editorPanel?.webview.postMessage(msgData);
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
        // 使用工作空间哈希值隔离不同项目的 rules
        const rulesDir = path.join(os.homedir(), '.panel-feedback');
        const rulesFile = this._workspaceHash 
            ? path.join(rulesDir, `rules-${this._workspaceHash}.txt`)
            : path.join(rulesDir, 'rules.txt');
        
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
        // 使用工作空间哈希值隔离不同项目的 rules
        const rulesFile = this._workspaceHash 
            ? path.join(rulesDir, `rules-${this._workspaceHash}.txt`)
            : path.join(rulesDir, 'rules.txt');
        
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

    // ========== 输入历史管理 ==========
    
    private _getInputHistoryFilePath(): string {
        const os = require('os');
        const path = require('path');
        const historyDir = path.join(os.homedir(), '.panel-feedback');
        return this._workspaceHash 
            ? path.join(historyDir, `input-history-${this._workspaceHash}.json`)
            : path.join(historyDir, 'input-history.json');
    }

    private _loadInputHistory() {
        const fs = require('fs');
        const historyFile = this._getInputHistoryFilePath();
        
        try {
            if (fs.existsSync(historyFile)) {
                const data = fs.readFileSync(historyFile, 'utf-8');
                this._inputHistory = JSON.parse(data);
            }
        } catch (e) {
            console.error('Failed to load input history:', e);
            this._inputHistory = [];
        }
        
        this._syncInputHistoryToAllWebviews();
    }

    private _saveInputHistory() {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const historyDir = path.join(os.homedir(), '.panel-feedback');
        const historyFile = this._getInputHistoryFilePath();
        
        try {
            if (!fs.existsSync(historyDir)) {
                fs.mkdirSync(historyDir, { recursive: true });
            }
            fs.writeFileSync(historyFile, JSON.stringify(this._inputHistory), 'utf-8');
        } catch (e) {
            console.error('Failed to save input history:', e);
        }
    }

    private _addInputHistory(text: string) {
        if (!text || !text.trim()) return;
        
        // 检查是否已存在
        const existingIndex = this._inputHistory.findIndex(item => item.text === text);
        if (existingIndex !== -1) {
            const existing = this._inputHistory[existingIndex];
            this._inputHistory.splice(existingIndex, 1);
            existing.timestamp = Date.now();
            // 置顶项保持在最前面，非置顶项插入到置顶项之后
            if (existing.pinned) {
                this._inputHistory.unshift(existing);
            } else {
                const firstNonPinnedIndex = this._inputHistory.findIndex(item => !item.pinned);
                if (firstNonPinnedIndex === -1) {
                    this._inputHistory.push(existing);
                } else {
                    this._inputHistory.splice(firstNonPinnedIndex, 0, existing);
                }
            }
        } else {
            // 新项插入到置顶项之后
            const newItem: InputHistoryItem = { text, timestamp: Date.now(), pinned: false };
            const firstNonPinnedIndex = this._inputHistory.findIndex(item => !item.pinned);
            if (firstNonPinnedIndex === -1) {
                this._inputHistory.push(newItem);
            } else {
                this._inputHistory.splice(firstNonPinnedIndex, 0, newItem);
            }
        }
        
        // 限制数量：置顶项不计入限制
        const pinnedItems = this._inputHistory.filter(item => item.pinned);
        const nonPinnedItems = this._inputHistory.filter(item => !item.pinned);
        if (nonPinnedItems.length > FeedbackPanelProvider.MAX_INPUT_HISTORY) {
            this._inputHistory = [...pinnedItems, ...nonPinnedItems.slice(0, FeedbackPanelProvider.MAX_INPUT_HISTORY)];
        }
        
        this._saveInputHistory();
        this._syncInputHistoryToAllWebviews();
    }

    private _deleteInputHistory(index: number) {
        if (index >= 0 && index < this._inputHistory.length) {
            this._inputHistory.splice(index, 1);
            this._saveInputHistory();
            this._syncInputHistoryToAllWebviews();
        }
    }

    private _togglePinInputHistory(index: number) {
        if (index >= 0 && index < this._inputHistory.length) {
            this._inputHistory[index].pinned = !this._inputHistory[index].pinned;
            // 重新排序：置顶项在前
            const pinnedItems = this._inputHistory.filter(item => item.pinned);
            const nonPinnedItems = this._inputHistory.filter(item => !item.pinned);
            this._inputHistory = [...pinnedItems, ...nonPinnedItems];
            this._saveInputHistory();
            this._syncInputHistoryToAllWebviews();
        }
    }

    private _syncInputHistoryToAllWebviews() {
        const msgData = { type: 'inputHistoryLoaded', inputHistory: this._inputHistory };
        this._view?.webview.postMessage(msgData);
        this._editorPanel?.webview.postMessage(msgData);
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
    
    // 设置结束对话回调
    public setOnEndConversation(callback: () => void) {
        this._onEndConversation = callback;
    }

    // 设置扩展上下文（用于自动打开 tab 页）
    public setExtensionContext(context: vscode.ExtensionContext) {
        this._extensionContext = context;
    }
    
    private _handleEndConversation() {
        console.log('End conversation triggered, pendingResolve:', !!this._pendingResolve);
        // 结束对话：向 AI 发送结束信号
        if (this._pendingResolve) {
            console.log('Resolving pending request with end signal');
            this._pendingResolve('[用户主动结束了对话]');
            this._pendingResolve = undefined;
        }
        // 调用结束对话回调（清理 MCP 状态）
        this._onEndConversation?.();
        // 清除历史并重置 UI
        this.clearHistory();
    }
    
    public clearHistory() {
        console.log('clearHistory called');
        this._chatHistory = [];
        this._currentMessage = '';
        this._currentOptions = [];
        // 发送重置消息到两个 webview
        const msgData = { type: 'resetToEmpty' };
        if (this._view) {
            console.log('Sending resetToEmpty to sidebar');
            this._view.webview.postMessage(msgData);
        }
        if (this._editorPanel) {
            console.log('Sending resetToEmpty to editor panel');
            this._editorPanel.webview.postMessage(msgData);
        }
    }

    // 同步状态到所有 webview
    private _syncStateToAllWebviews() {
        const msgData = {
            type: 'showMessage',
            message: this._currentMessage,
            options: this._currentOptions,
            history: this._chatHistory
        };
        if (this._view) {
            this._view.webview.postMessage(msgData);
        }
        if (this._editorPanel) {
            this._editorPanel.webview.postMessage(msgData);
        }
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

        // 同步发送到两个 webview
        if (this._editorPanel) {
            this._editorPanel.reveal();
            this._editorPanel.webview.postMessage(msgData);
        }
        if (this._view) {
            this._view.webview.postMessage(msgData);
        }
        
        // 如果两个都没有，尝试打开
        if (!this._editorPanel && !this._view) {
            await vscode.commands.executeCommand('feedbackPanel.view.focus');
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        // 再次检查并发送
        if (this._view && !this._editorPanel) {
            this._view.webview.postMessage(msgData);
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

        this._editorPanel.webview.html = this._getHtmlForWebview(this._editorPanel.webview, true);

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
                case 'getWorkspaceInfo':
                    this._sendWorkspaceInfo();
                    break;
                case 'endConversation':
                    this._handleEndConversation();
                    break;
                case 'copyToClipboard':
                    vscode.env.clipboard.writeText(data.text);
                    break;
                case 'openLogFolder':
                    this._openLogFolder();
                    break;
                case 'selectFile':
                    this._handleSelectFile(data.selectType);
                    break;
                case 'getWorkspaceFiles':
                    this._handleGetWorkspaceFiles(data.query || '');
                    break;
                case 'loadInputHistory':
                    this._loadInputHistory();
                    break;
                case 'addInputHistory':
                    this._addInputHistory(data.text);
                    break;
                case 'deleteInputHistory':
                    this._deleteInputHistory(data.index);
                    break;
                case 'togglePinInputHistory':
                    this._togglePinInputHistory(data.index);
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

    private _getHtmlForWebview(webview: vscode.Webview, isEditorPanel: boolean = false): string {
        // 获取配置的最小宽度
        const config = vscode.workspace.getConfiguration('feedbackPanel');
        const minWidth = config.get<number>('minWidth', 280);
        
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
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            min-width: ${minWidth}px;
        }
        .top-toolbar {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            background: rgba(var(--vscode-sideBar-background), 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-bottom: 1px solid var(--vscode-widget-border);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .toolbar-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.7;
            transition: all 0.15s ease;
        }
        .toolbar-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .toolbar-btn svg {
            width: 16px;
            height: 16px;
        }
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 12px;
            overflow: hidden;
        }
        html {
            min-width: ${minWidth}px;
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
            text-align: left;
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
        .input-wrapper {
            position: relative;
            display: flex;
            flex-direction: column;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 12px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .input-wrapper:focus-within {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }
        textarea {
            width: 100%;
            min-height: 60px;
            max-height: 200px;
            padding: 12px 14px;
            padding-bottom: 8px;
            background: transparent;
            color: var(--vscode-input-foreground);
            border: none;
            border-radius: 12px 12px 0 0;
            resize: none;
            font-family: inherit;
            font-size: 13px;
            line-height: 1.5;
        }
        textarea:focus {
            outline: none;
        }
        textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .input-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 10px;
            border-top: 1px solid var(--vscode-widget-border);
            background: rgba(128, 128, 128, 0.05);
            border-radius: 0 0 12px 12px;
        }
        .input-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
            margin-right: 16px;
        }
        .input-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 6px 12px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.15s ease;
        }
        .action-btn svg {
            width: 14px;
            height: 14px;
        }
        .submit-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .submit-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        .submit-btn:active {
            transform: translateY(0);
        }
        .end-btn {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-widget-border);
        }
        .end-btn:hover {
            background: var(--vscode-errorForeground);
            color: white;
            border-color: var(--vscode-errorForeground);
        }
        .input-area.disabled {
            opacity: 0.5;
            pointer-events: none;
        }
        .input-area.disabled .end-btn {
            pointer-events: auto;
            opacity: 1;
        }
        .input-area.disabled .end-btn:hover {
            background: var(--vscode-errorForeground);
            color: white;
            border-color: var(--vscode-errorForeground);
        }
        .history-btn {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-widget-border);
            padding: 6px 10px;
        }
        .history-btn:hover {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-foreground);
        }
        .history-btn.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        .input-history-panel {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 0;
            right: 0;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            margin-bottom: 8px;
            max-height: 280px;
            overflow-y: auto;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
            z-index: 100;
        }
        .input-history-panel.show {
            display: block;
        }
        .input-history-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
        }
        .input-history-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .input-history-close {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 16px;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .input-history-close:hover {
            background: var(--vscode-button-secondaryBackground);
        }
        .input-history-list {
            padding: 4px 0;
        }
        .input-history-item {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            transition: background 0.15s;
            gap: 10px;
        }
        .input-history-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .input-history-item .check-icon {
            color: var(--vscode-textLink-foreground);
            font-size: 12px;
            flex-shrink: 0;
        }
        .input-history-item .content {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 13px;
            color: var(--vscode-foreground);
        }
        .input-history-item .time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            flex-shrink: 0;
        }
        .input-history-item .delete-btn,
        .input-history-item .pin-btn {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 2px 6px;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .input-history-item:hover .delete-btn,
        .input-history-item:hover .pin-btn {
            opacity: 1;
        }
        .input-history-item .delete-btn:hover {
            color: var(--vscode-errorForeground);
        }
        .input-history-item .pin-btn:hover {
            color: var(--vscode-textLink-foreground);
        }
        .input-history-item .pin-btn.pinned {
            opacity: 1;
            color: var(--vscode-textLink-foreground);
        }
        .input-history-item.pinned {
            background: rgba(33, 150, 243, 0.05);
        }
        .input-history-item.pinned .check-icon {
            color: var(--vscode-textLink-foreground);
        }
        .input-history-empty {
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            padding: 20px;
        }
        .empty-state svg {
            width: 48px;
            height: 48px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        .empty-state p {
            margin-bottom: 16px;
        }
        .start-chat-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .start-chat-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        .start-chat-btn svg {
            width: 16px;
            height: 16px;
            margin: 0;
            opacity: 1;
        }
        .start-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 12px;
            opacity: 0.8;
        }
        .copy-success {
            color: var(--vscode-testing-iconPassed);
            font-size: 12px;
            margin-top: 8px;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .copy-success.show {
            opacity: 1;
        }
        .workspace-info {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 12px;
            padding: 8px 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
        }
        .workspace-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .workspace-hash {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 600;
            letter-spacing: 1px;
        }
        .copy-hash-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            opacity: 0.6;
            transition: opacity 0.2s;
            padding: 2px;
        }
        .copy-hash-btn:hover {
            opacity: 1;
        }
        .start-dialog-btn {
            margin-top: 16px;
            padding: 8px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background 0.2s, transform 0.1s;
        }
        .start-dialog-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        .start-dialog-btn:active {
            transform: translateY(0);
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
        
        /* @ 提及菜单样式 */
        .mention-menu {
            display: none;
            position: absolute;
            bottom: calc(100% + 4px);
            left: 14px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 150;
            min-width: 280px;
            max-width: 400px;
            overflow: hidden;
        }
        .mention-menu.show {
            display: block;
        }
        .mention-menu-header {
            padding: 8px 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-widget-border);
            background: rgba(128, 128, 128, 0.05);
        }
        .mention-menu-list {
            max-height: 320px;
            overflow-y: auto;
        }
        .mention-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 13px;
            color: var(--vscode-foreground);
        }
        .mention-menu-item:hover,
        .mention-menu-item.selected {
            background: var(--vscode-list-hoverBackground);
        }
        .mention-menu-item .icon {
            font-size: 14px;
            width: 18px;
            text-align: center;
            flex-shrink: 0;
        }
        .mention-menu-item .label {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .mention-menu-item .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 150px;
        }
        .mention-menu-empty {
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .mention-menu-loading {
            padding: 12px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .mention-menu-item .expand-btn {
            width: 36px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            background: transparent;
            margin: -4px -8px -4px 0;
            cursor: pointer;
            color: var(--vscode-foreground);
            opacity: 0.6;
            border-radius: 3px;
            flex-shrink: 0;
            font-size: 10px;
            transition: opacity 0.15s, background 0.15s;
        }
        .mention-menu-item .expand-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
        }
        .mention-menu-breadcrumb {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-widget-border);
            background: rgba(128, 128, 128, 0.03);
        }
        .mention-menu-breadcrumb .back-btn {
            padding: 6px 12px;
            border: none;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            min-height: 28px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .mention-menu-breadcrumb .back-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .mention-menu-breadcrumb .back-btn:active {
            transform: scale(0.98);
        }
        
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
    <!-- 顶部工具栏 -->
    <div class="top-toolbar">
        <button class="toolbar-btn" id="openTabBtn" title="在编辑器中打开" style="display: ${isEditorPanel ? 'none' : 'flex'};">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
        </button>
        <button class="toolbar-btn" id="clearHistoryBtn" title="清除历史">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
        </button>
        <button class="toolbar-btn" id="settingsBtn" title="设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        </button>
    </div>

    <div class="main-content">
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
        <p>等待 AI 发起对话...</p>
        <div id="workspaceInfo" class="workspace-info" style="display: none;">
            <span class="workspace-label">路由标识：</span>
            <code id="workspaceHashDisplay" class="workspace-hash"></code>
            <button id="copyHashBtn" class="copy-hash-btn" title="复制哈希值">📋</button>
        </div>
        <button id="startDialogBtn" class="start-dialog-btn" style="display: none;">开启对话</button>
    </div>

    <div id="feedbackArea" class="hidden" style="position: relative; flex-direction: column; height: 100%; overflow-y: auto;">
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
            <div class="input-wrapper">
                <div id="inputHistoryPanel" class="input-history-panel">
                    <div class="input-history-header">
                        <span class="input-history-title">历史指令</span>
                        <button class="input-history-close" id="closeHistoryPanel">×</button>
                    </div>
                    <div id="inputHistoryList" class="input-history-list"></div>
                </div>
                <div id="mentionMenu" class="mention-menu">
                    <div class="mention-menu-header">选择文件或文件夹</div>
                    <div id="mentionBreadcrumb" class="mention-menu-breadcrumb" style="display: none;"></div>
                    <div id="mentionMenuList" class="mention-menu-list">
                        <div class="mention-menu-loading">加载中...</div>
                    </div>
                </div>
                <textarea 
                    id="feedbackInput" 
                    placeholder="输入反馈内容，@ 引用文件，支持粘贴图片 (Ctrl+V)..."
                    rows="2"
                ></textarea>
                <div class="input-toolbar">
                    <div class="input-actions" style="margin-right: auto;">
                        <button class="action-btn history-btn" id="historyBtn" title="历史指令">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                        </button>
                    </div>
                    <span class="input-hint">Enter 发送 · Ctrl+Enter 换行</span>
                    <div class="input-actions">
                        <button class="action-btn end-btn" id="endBtn" title="结束对话">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                            </svg>
                            结束
                        </button>
                        <button class="action-btn submit-btn" id="submitBtn" title="发送反馈">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                            </svg>
                            发送
                        </button>
                    </div>
                </div>
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
        const openTabBtn = document.getElementById('openTabBtn');
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        const settingsBtn = document.getElementById('settingsBtn');

        let images = [];
        let historyData = [];
        let currentRules = '';
        
        // 工作空间信息（需要先定义，后面会用到）
        let workspaceHash = '';
        let workspaceName = '';
        
        // 输入历史记录（由后端统一管理）
        let inputHistory = [];
        
        // 从后端加载历史
        function loadInputHistory() {
            vscode.postMessage({ type: 'loadInputHistory' });
        }
        
        // 添加输入到历史（通知后端）
        function addToInputHistory(text) {
            if (!text || !text.trim()) return;
            vscode.postMessage({ type: 'addInputHistory', text: text });
        }
        
        // 切换置顶状态（通知后端）
        function togglePinItem(index) {
            vscode.postMessage({ type: 'togglePinInputHistory', index: index });
        }
        
        // 删除历史项（通知后端）
        function deleteInputHistoryItem(index) {
            vscode.postMessage({ type: 'deleteInputHistory', index: index });
        }
        
        // 格式化相对时间
        function formatRelativeTime(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (seconds < 60) return '刚刚';
            if (minutes < 60) return minutes + '分钟前';
            if (hours < 24) return hours + '小时前';
            if (days < 7) return days + '天前';
            return new Date(timestamp).toLocaleDateString('zh-CN');
        }
        
        // 渲染历史列表
        function renderInputHistory() {
            const list = document.getElementById('inputHistoryList');
            
            if (inputHistory.length === 0) {
                list.innerHTML = '<div class="input-history-empty">暂无历史记录</div>';
                return;
            }
            
            list.innerHTML = inputHistory.map((item, index) => \`
                <div class="input-history-item\${item.pinned ? ' pinned' : ''}" data-index="\${index}">
                    <span class="check-icon">\${item.pinned ? '📌' : '✓'}</span>
                    <span class="content" title="\${item.text.replace(/"/g, '&quot;')}">\${item.text}</span>
                    <span class="time">\${formatRelativeTime(item.timestamp)}</span>
                    <button class="pin-btn\${item.pinned ? ' pinned' : ''}" data-index="\${index}" title="\${item.pinned ? '取消置顶' : '置顶'}">📌</button>
                    <button class="delete-btn" data-index="\${index}" title="删除">×</button>
                </div>
            \`).join('');
        }
        
        // 历史面板元素
        const historyBtn = document.getElementById('historyBtn');
        const inputHistoryPanel = document.getElementById('inputHistoryPanel');
        const closeHistoryPanel = document.getElementById('closeHistoryPanel');
        const inputHistoryList = document.getElementById('inputHistoryList');
        
        // 切换历史面板
        historyBtn.onclick = () => {
            const isShow = inputHistoryPanel.classList.toggle('show');
            historyBtn.classList.toggle('active', isShow);
            if (isShow) {
                renderInputHistory();
            }
        };
        
        // 关闭历史面板
        closeHistoryPanel.onclick = () => {
            inputHistoryPanel.classList.remove('show');
            historyBtn.classList.remove('active');
        };
        
        // 点击历史项填充到输入框
        inputHistoryList.onclick = (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn) {
                e.stopPropagation();
                const index = parseInt(deleteBtn.dataset.index);
                deleteInputHistoryItem(index);
                return;
            }
            
            const pinBtn = e.target.closest('.pin-btn');
            if (pinBtn) {
                e.stopPropagation();
                const index = parseInt(pinBtn.dataset.index);
                togglePinItem(index);
                return;
            }
            
            const item = e.target.closest('.input-history-item');
            if (item) {
                const index = parseInt(item.dataset.index);
                const historyItem = inputHistory[index];
                if (historyItem) {
                    feedbackInput.value = historyItem.text;
                    feedbackInput.focus();
                    inputHistoryPanel.classList.remove('show');
                    historyBtn.classList.remove('active');
                }
            }
        };
        
        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (!inputHistoryPanel.contains(e.target) && 
                !historyBtn.contains(e.target) && 
                inputHistoryPanel.classList.contains('show')) {
                inputHistoryPanel.classList.remove('show');
                historyBtn.classList.remove('active');
            }
            // 点击外部关闭 @ 提及菜单
            const mentionMenu = document.getElementById('mentionMenu');
            if (mentionMenu && !mentionMenu.contains(e.target) && 
                e.target !== feedbackInput && 
                mentionMenu.classList.contains('show')) {
                mentionMenu.classList.remove('show');
            }
        });
        
        // @ 提及功能
        const mentionMenu = document.getElementById('mentionMenu');
        const mentionMenuList = document.getElementById('mentionMenuList');
        let mentionStartPos = -1;  // @ 符号的位置
        let selectedMentionIndex = 0;  // 当前选中的菜单项索引
        let workspaceFiles = [];  // 工作区文件列表缓存
        let filteredFiles = [];  // 过滤后的文件列表
        let currentFolderPath = '';  // 当前浏览的文件夹路径
        let folderHistory = [];  // 文件夹浏览历史，用于返回
        
        // 更新菜单项选中状态
        function updateMentionSelection() {
            const items = mentionMenu.querySelectorAll('.mention-menu-item');
            items.forEach((item, idx) => {
                item.classList.toggle('selected', idx === selectedMentionIndex);
            });
            // 滚动到选中项
            const selectedItem = items[selectedMentionIndex];
            if (selectedItem) {
                selectedItem.scrollIntoView({ block: 'nearest' });
            }
        }
        
        // 检查文件夹是否有子级
        function folderHasChildren(folderPath) {
            return workspaceFiles.some(f => {
                const parentPath = f.relativePath.substring(0, f.relativePath.lastIndexOf('/') !== -1 ? f.relativePath.lastIndexOf('/') : f.relativePath.lastIndexOf('\\\\'));
                return parentPath === folderPath || f.relativePath.startsWith(folderPath + '/') || f.relativePath.startsWith(folderPath + '\\\\');
            });
        }
        
        // 获取当前文件夹下的直接子级
        function getChildrenOfFolder(folderPath) {
            if (!folderPath) {
                // 根目录：返回 depth=1 的文件和文件夹
                return workspaceFiles.filter(f => f.depth === 1);
            }
            const normalizedPath = folderPath.replace(/\\\\/g, '/');
            return workspaceFiles.filter(f => {
                const normalizedRelative = f.relativePath.replace(/\\\\/g, '/');
                if (!normalizedRelative.startsWith(normalizedPath + '/')) return false;
                const remaining = normalizedRelative.substring(normalizedPath.length + 1);
                return !remaining.includes('/');
            });
        }
        
        // 渲染面包屑导航
        function renderBreadcrumb() {
            const breadcrumbContainer = document.getElementById('mentionBreadcrumb');
            if (!breadcrumbContainer) return;
            
            if (!currentFolderPath) {
                breadcrumbContainer.style.display = 'none';
                return;
            }
            
            breadcrumbContainer.style.display = 'flex';
            breadcrumbContainer.innerHTML = \`
                <button class="back-btn" id="mentionBackBtn">← 返回</button>
                <span>📂 \${currentFolderPath}</span>
            \`;
        }
        
        // 进入文件夹
        function enterFolder(folderPath) {
            folderHistory.push(currentFolderPath);
            currentFolderPath = folderPath;
            const children = getChildrenOfFolder(folderPath);
            renderBreadcrumb();
            renderFileList(children);
        }
        
        // 返回上一级
        function goBack() {
            if (folderHistory.length > 0) {
                currentFolderPath = folderHistory.pop();
            } else {
                currentFolderPath = '';
            }
            const children = getChildrenOfFolder(currentFolderPath);
            renderBreadcrumb();
            renderFileList(children);
        }
        
        // 渲染文件列表
        function renderFileList(files) {
            filteredFiles = files;
            if (files.length === 0) {
                mentionMenuList.innerHTML = '<div class="mention-menu-empty">没有找到匹配的文件</div>';
                return;
            }
            
            const html = files.slice(0, 20).map((file, idx) => {
                const icon = file.isFolder ? '📁' : '📄';
                const hasChildren = file.isFolder && folderHasChildren(file.relativePath);
                const expandBtn = hasChildren ? \`<button class="expand-btn" data-folder="\${file.relativePath}" title="展开文件夹">▶</button>\` : '';
                return \`<div class="mention-menu-item\${idx === selectedMentionIndex ? ' selected' : ''}" data-path="\${file.fullPath}" data-name="\${file.name}" data-is-folder="\${file.isFolder}" data-relative="\${file.relativePath}">
                    <span class="icon">\${icon}</span>
                    <span class="label">\${file.name}</span>
                    <span class="hint">\${file.fullPath}</span>
                    \${expandBtn}
                </div>\`;
            }).join('');
            
            mentionMenuList.innerHTML = html;
        }
        
        // 过滤文件列表
        function filterFiles(query) {
            if (!query) {
                renderFileList(workspaceFiles.slice(0, 20));
                return;
            }
            const lowerQuery = query.toLowerCase();
            const filtered = workspaceFiles.filter(f => 
                f.name.toLowerCase().includes(lowerQuery) || 
                f.relativePath.toLowerCase().includes(lowerQuery)
            );
            renderFileList(filtered);
        }
        
        // 显示提及菜单
        function showMentionMenu() {
            mentionMenu.classList.add('show');
            selectedMentionIndex = 0;
            // 重置文件夹浏览状态
            currentFolderPath = '';
            folderHistory = [];
            renderBreadcrumb();
            mentionMenuList.innerHTML = '<div class="mention-menu-loading">加载中...</div>';
            // 请求工作区文件
            vscode.postMessage({ type: 'getWorkspaceFiles', query: '' });
        }
        
        // 隐藏提及菜单
        function hideMentionMenu() {
            mentionMenu.classList.remove('show');
            mentionStartPos = -1;
            // 重置文件夹浏览状态
            currentFolderPath = '';
            folderHistory = [];
        }
        
        // 处理菜单项选择 - 使用绝对路径
        function selectMentionItem(fullPath, fileName) {
            // 替换 @ 及之后输入的搜索词为选中的文件路径
            // 显示格式: @文件名，实际值: 绝对路径
            if (mentionStartPos >= 0) {
                const text = feedbackInput.value;
                const cursorPos = feedbackInput.selectionStart;
                const beforeAt = text.substring(0, mentionStartPos);
                const afterSearch = text.substring(cursorPos);
                // 使用绝对路径作为实际值
                const newText = beforeAt + '\`' + fullPath + '\`' + afterSearch;
                feedbackInput.value = newText;
                const newCursorPos = mentionStartPos + fullPath.length + 2;
                feedbackInput.selectionStart = feedbackInput.selectionEnd = newCursorPos;
            }
            hideMentionMenu();
        }
        
        // 监听输入框输入
        feedbackInput.addEventListener('input', (e) => {
            const cursorPos = feedbackInput.selectionStart;
            const text = feedbackInput.value;
            const lastChar = text.charAt(cursorPos - 1);
            
            // 检测 @ 符号
            if (lastChar === '@') {
                // 检查前一个字符是否为空格或行首
                const prevChar = cursorPos > 1 ? text.charAt(cursorPos - 2) : '';
                if (prevChar === '' || prevChar === ' ' || prevChar === '\\n') {
                    mentionStartPos = cursorPos - 1;
                    showMentionMenu();
                }
            } else if (mentionMenu.classList.contains('show')) {
                // 如果菜单显示中，根据输入过滤文件列表
                const textAfterAt = text.substring(mentionStartPos + 1, cursorPos);
                if (textAfterAt.includes(' ') || textAfterAt.length > 30) {
                    hideMentionMenu();
                } else {
                    // 过滤文件列表
                    filterFiles(textAfterAt);
                    selectedMentionIndex = 0;
                    updateMentionSelection();
                }
            }
        });
        
        // 监听键盘事件处理菜单导航
        feedbackInput.addEventListener('keydown', (e) => {
            if (!mentionMenu.classList.contains('show')) return;
            
            const items = mentionMenu.querySelectorAll('.mention-menu-item');
            if (items.length === 0) return;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedMentionIndex = (selectedMentionIndex + 1) % items.length;
                updateMentionSelection();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedMentionIndex = (selectedMentionIndex - 1 + items.length) % items.length;
                updateMentionSelection();
            } else if (e.key === 'Enter' && !e.ctrlKey) {
                e.preventDefault();
                const selectedItem = items[selectedMentionIndex];
                if (selectedItem && selectedItem.dataset.path) {
                    selectMentionItem(selectedItem.dataset.path, selectedItem.dataset.name);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideMentionMenu();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                const selectedItem = items[selectedMentionIndex];
                if (selectedItem && selectedItem.dataset.path) {
                    selectMentionItem(selectedItem.dataset.path, selectedItem.dataset.name);
                }
            }
        });
        
        // 点击菜单项
        mentionMenu.addEventListener('click', (e) => {
            // 点击返回按钮
            const backBtn = e.target.closest('#mentionBackBtn');
            if (backBtn) {
                e.stopPropagation();
                goBack();
                return;
            }
            
            // 点击展开箭头按钮
            const expandBtn = e.target.closest('.expand-btn');
            if (expandBtn && expandBtn.dataset.folder) {
                e.stopPropagation();
                enterFolder(expandBtn.dataset.folder);
                return;
            }
            
            // 点击菜单项本身 -> 选择路径（使用绝对路径）
            const item = e.target.closest('.mention-menu-item');
            if (item && item.dataset.path) {
                selectMentionItem(item.dataset.path, item.dataset.name);
            }
        });
        
        // 固定操作映射
        const fixedActionTexts = {
            'commitAndPush': '执行 git commit 和 push：1. 先运行 git diff --cached 或 git status 获取暂存的更改内容 2. 根据更改内容自动生成简洁专业的提交信息（格式：类型: 简短描述） 3. 直接执行 git commit -m "生成的信息" 和 git push，不需要询问我确认',
            'codeReview': '审查当前更改的代码，检查潜在问题和改进建议',
            'formatCode': '整理当前文件的代码格式：1. 按执行顺序排列代码 2. 相同类型的代码归类在一起（如常量、变量、函数、类等）3. 清除没有引用的代码 4. 所有对象引用都使用 using 语句 5. 保持逻辑清晰的代码结构'
        };
        
        // 加载已保存的 rules
        vscode.postMessage({ type: 'loadRules' });
        
        // 获取工作空间信息
        vscode.postMessage({ type: 'getWorkspaceInfo' });
        
        // 工作空间信息元素
        const workspaceInfo = document.getElementById('workspaceInfo');
        const workspaceHashDisplay = document.getElementById('workspaceHashDisplay');
        const copyHashBtn = document.getElementById('copyHashBtn');
        
        // 复制哈希值按钮
        copyHashBtn.onclick = () => {
            if (workspaceHash) {
                vscode.postMessage({ type: 'copyToClipboard', text: workspaceHash });
                copyHashBtn.textContent = '✓';
                setTimeout(() => {
                    copyHashBtn.textContent = '📋';
                }, 1500);
            }
        };
        
        // 开启对话按钮
        const startDialogBtn = document.getElementById('startDialogBtn');
        startDialogBtn.onclick = () => {
            if (workspaceHash) {
                const command = '使用 panel_feedback MCP 工具与我进行交互对话，workspace_hash 参数填写 "' + workspaceHash + '"';
                vscode.postMessage({ type: 'copyToClipboard', text: command });
                startDialogBtn.textContent = '已复制指令 ✓';
                setTimeout(() => {
                    startDialogBtn.textContent = '开启对话';
                }, 2000);
            }
        };
        
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
        
        // 工具栏按钮事件
        if (openTabBtn) {
            openTabBtn.addEventListener('click', () => {
                vscode.postMessage({ type: 'openInEditor' });
            });
        }
        
        clearHistoryBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'clearHistory' });
        });
        
        settingsBtn.addEventListener('click', () => {
            rulesTextarea.value = currentRules;
            settingsModal.classList.add('show');
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
            feedbackArea.style.display = 'flex';  // 确保显示为 flex
            
            // 隐藏等待提示
            const waitingDiv = document.getElementById('waitingHint');
            if (waitingDiv) waitingDiv.style.display = 'none';
            
            // 显示当前问题和输入区
            currentQuestion.style.display = 'block';
            document.querySelector('.input-area').style.display = 'flex';
            enableInputArea();  // 启用输入区
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
            
            // 保存到输入历史
            if (text) {
                addToInputHistory(text);
            }
            
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

        // 显示等待状态（保留历史，输入区禁用但可见，结束按钮可用）
        function showWaitingState() {
            feedbackInput.value = '';
            images = [];
            updateImagePreview();
            
            // 隐藏当前问题和选项
            currentQuestion.style.display = 'none';
            optionsContainer.innerHTML = '';
            optionsContainer.style.display = 'none';
            fixedActions.style.display = 'none';  // 隐藏固定操作
            
            // 输入区保持显示但禁用（结束按钮除外）
            const inputArea = document.querySelector('.input-area');
            inputArea.style.display = 'flex';
            inputArea.classList.add('disabled');
            feedbackInput.placeholder = '等待 AI 回复...';
            
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
        
        // 启用输入区
        function enableInputArea() {
            const inputArea = document.querySelector('.input-area');
            inputArea.classList.remove('disabled');
            feedbackInput.placeholder = '输入反馈内容，支持粘贴图片 (Ctrl+V)...';
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
            emptyState.style.display = 'flex';  // 确保显示
            feedbackArea.classList.add('hidden');
            feedbackArea.style.display = 'none';  // 确保隐藏
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
        
        // 结束对话按钮
        const endBtn = document.getElementById('endBtn');
        endBtn.onclick = () => {
            // webview 中 confirm() 不可用，直接发送结束信号
            vscode.postMessage({ type: 'endConversation' });
        };

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
                case 'resetToEmpty':
                    historyData = [];
                    resetToEmpty();
                    break;
                case 'workspaceInfo':
                    workspaceHash = data.workspaceHash || '';
                    workspaceName = data.workspaceName || '';
                    if (workspaceHash) {
                        workspaceHashDisplay.textContent = workspaceHash;
                        workspaceInfo.style.display = 'flex';
                        startDialogBtn.style.display = 'block';
                    }
                    // 收到工作空间信息后加载历史
                    loadInputHistory();
                    break;
                case 'workspaceFiles':
                    // 接收工作区文件列表
                    workspaceFiles = data.files || [];
                    renderFileList(workspaceFiles.slice(0, 20));
                    break;
                case 'fileSelected':
                    // 处理文件选择结果，将路径插入到输入框
                    if (data.paths && data.paths.length > 0) {
                        const pathText = data.paths.map(p => '\`' + p + '\`').join(' ');
                        const currentText = feedbackInput.value;
                        const cursorPos = feedbackInput.selectionStart;
                        const before = currentText.substring(0, cursorPos);
                        const after = currentText.substring(cursorPos);
                        feedbackInput.value = before + pathText + ' ' + after;
                        feedbackInput.focus();
                        feedbackInput.selectionStart = feedbackInput.selectionEnd = cursorPos + pathText.length + 1;
                    }
                    break;
                case 'inputHistoryLoaded':
                    // 接收后端同步的输入历史
                    inputHistory = data.inputHistory || [];
                    renderInputHistory();
                    break;
            }
        });
    </script>
</div>
</body>
</html>`;
    }
}
