import * as http from 'http';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FeedbackPanelProvider } from './FeedbackPanelProvider';

interface PendingRequest {
    id: string;
    params: any;
    status: 'pending' | 'completed' | 'error';
    result?: any;
    error?: string;
    createdAt: number;
}

export class MCPServer {
    private server: http.Server | null = null;
    private port: number = 0;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private context: vscode.ExtensionContext | null = null;
    
    private static readonly REGISTRY_DIR = path.join(os.homedir(), '.panel-feedback');
    private static readonly PORT_FILE = path.join(os.homedir(), '.panel-feedback', 'port.json');

    constructor(private provider: FeedbackPanelProvider) {}

    // 设置扩展上下文（用于持久化）
    setContext(context: vscode.ExtensionContext) {
        this.context = context;
        this.restorePendingRequests();
    }

    // 从持久化存储恢复未完成请求
    private restorePendingRequests() {
        if (!this.context) return;
        
        const stored = this.context.globalState.get<PendingRequest[]>('pendingRequests', []);
        const now = Date.now();
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        
        for (const req of stored) {
            if (req.status === 'pending' && (now - req.createdAt) < SEVEN_DAYS) {
                this.pendingRequests.set(req.id, req);
                this.processRequest(req);
            }
        }
        
        console.log(`Restored ${this.pendingRequests.size} pending requests`);
    }

    // 清除所有待处理请求
    public clearPendingRequests(): void {
        this.pendingRequests.clear();
        this.persistRequests();
        console.log('All pending requests cleared');
    }

    // 持久化请求状态
    private persistRequests() {
        if (!this.context) return;
        const requests = Array.from(this.pendingRequests.values());
        this.context.globalState.update('pendingRequests', requests);
    }

    // 处理请求（显示到面板）
    private async processRequest(request: PendingRequest) {
        try {
            const { message, predefined_options } = request.params.arguments || {};
            console.log('[MCP] processRequest - message:', message?.substring(0, 50), 'options:', predefined_options);
            
            const feedback = await this.provider.showMessage(
                message || '',
                predefined_options,
                request.id
            );
            
            const content = this.parseResponse(feedback);
            
            request.status = 'completed';
            request.result = { content };
            this.persistRequests();
        } catch (err: any) {
            request.status = 'error';
            request.error = err.message;
            this.persistRequests();
        }
    }

    private parseResponse(feedback: string): any[] {
        const content: any[] = [];
        
        try {
            const parsed = JSON.parse(feedback);
            if (parsed.text) {
                content.push({ type: 'text', text: parsed.text });
            }
            if (parsed.images && Array.isArray(parsed.images)) {
                for (const imageDataUrl of parsed.images) {
                    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        content.push({
                            type: 'image',
                            data: match[2],
                            mimeType: match[1]
                        });
                    }
                }
            }
        } catch {
            content.push({ type: 'text', text: feedback });
        }
        
        if (content.length === 0) {
            content.push({ type: 'text', text: '' });
        }
        
        return content;
    }

    // 写入端口文件
    private writePortFile(): void {
        try {
            if (!fs.existsSync(MCPServer.REGISTRY_DIR)) {
                fs.mkdirSync(MCPServer.REGISTRY_DIR, { recursive: true });
            }
            fs.writeFileSync(MCPServer.PORT_FILE, JSON.stringify({ port: this.port }, null, 2));
        } catch (e) {
            console.error('Failed to write port file:', e);
        }
    }

    // 删除端口文件
    private deletePortFile(): void {
        try {
            if (fs.existsSync(MCPServer.PORT_FILE)) {
                fs.unlinkSync(MCPServer.PORT_FILE);
            }
        } catch (e) {
            console.error('Failed to delete port file:', e);
        }
    }

    async start() {
        this.server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method !== 'POST') {
                res.writeHead(405);
                res.end('Method Not Allowed');
                return;
            }

            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);
                    let response;

                    if (req.url === '/submit') {
                        response = await this.handleSubmit(data);
                    } else if (req.url === '/poll') {
                        response = this.handlePoll(data);
                    } else {
                        response = { error: 'Unknown endpoint' };
                    }
                    
                    res.setHeader('Content-Type', 'application/json');
                    res.writeHead(200);
                    res.end(JSON.stringify(response));
                } catch (err) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Parse error' }));
                }
            });
        });

        await this.tryListen();
    }

    private tryListen(): Promise<void> {
        return new Promise((resolve) => {
            this.server?.removeAllListeners('error');
            this.server?.removeAllListeners('listening');

            this.server?.once('error', (err: NodeJS.ErrnoException) => {
                console.error(`Failed to start server: ${err.message}`);
                resolve();
            });

            this.server?.once('listening', () => {
                const addr = this.server?.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                console.log(`MCP Feedback Server running on port ${this.port}`);
                this.writePortFile();
                resolve();
            });

            this.server?.listen(0, '127.0.0.1');
        });
    }

    private async handleSubmit(data: any): Promise<any> {
        const { requestId, params } = data;

        const request: PendingRequest = {
            id: requestId,
            params,
            status: 'pending',
            createdAt: Date.now()
        };

        this.pendingRequests.set(requestId, request);
        this.persistRequests();

        this.processRequest(request);

        return { status: 'accepted', requestId };
    }

    private handlePoll(data: any): any {
        const { requestId } = data;
        const request = this.pendingRequests.get(requestId);

        if (!request) {
            return { status: 'error', error: 'Request not found' };
        }

        if (request.status === 'completed') {
            this.pendingRequests.delete(requestId);
            this.persistRequests();
            return { status: 'completed', data: request.result };
        } else if (request.status === 'error') {
            this.pendingRequests.delete(requestId);
            this.persistRequests();
            return { status: 'error', error: request.error };
        }

        return { status: 'pending' };
    }

    stop() {
        this.deletePortFile();
        
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
