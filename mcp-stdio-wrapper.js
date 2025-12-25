#!/usr/bin/env node
/**
 * Stdio wrapper for windsurf-feedback-panel MCP
 * 使用轮询机制等待用户反馈，支持长时间等待
 */

const http = require('http');
const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置
const REGISTRY_DIR = path.join(os.homedir(), '.panel-feedback');
const DEFAULT_PORT = 19876;
const POLL_INTERVAL = 500;  // 500ms 轮询间隔
const MAX_POLL_TIME = 86400000 * 7;  // 最长等待 7 天
const SOFT_TIMEOUT = 120000;  // 2分钟软超时，自动返回让AI继续

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

// 获取目标端口（简化版：直接读取端口文件或使用默认端口）
function getTargetPort() {
    try {
        const portFile = path.join(REGISTRY_DIR, 'port.json');
        if (fs.existsSync(portFile)) {
            const content = fs.readFileSync(portFile, 'utf-8');
            const data = JSON.parse(content);
            if (data.port) {
                return data.port;
            }
        }
    } catch (e) {
        // ignore
    }
    return DEFAULT_PORT;
}

// 生成唯一请求 ID
function generateRequestId() {
    return crypto.randomUUID();
}

// 休眠函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 发送 HTTP 请求
function sendRequest(urlPath, data, targetPort) {
    const port = targetPort || DEFAULT_PORT;
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        const options = {
            hostname: '127.0.0.1',
            port: port,
            path: urlPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });

        req.on('error', (e) => {
            if (e.code === 'ECONNREFUSED') {
                resolve({ _connectionRefused: true });
            } else {
                reject(e);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

// 轮询获取结果
async function pollForResult(requestId, targetPort) {
    const startTime = Date.now();
    let connectionRefusedCount = 0;
    
    while (Date.now() - startTime < MAX_POLL_TIME) {
        try {
            const result = await sendRequest('/poll', { requestId }, targetPort);
            
            if (result._connectionRefused) {
                connectionRefusedCount++;
                if (connectionRefusedCount > 10) {
                    throw new Error('扩展未启动。请先在 IDE 中打开 Panel Feedback 面板。');
                }
            } else {
                connectionRefusedCount = 0;
                
                if (result.status === 'completed') {
                    return result.data;
                } else if (result.status === 'error') {
                    throw new Error(result.error || 'Unknown error');
                }
            }
        } catch (err) {
            if (!err.message.includes('扩展未启动')) {
                process.stderr.write(`Poll error: ${err.message}\n`);
            } else {
                throw err;
            }
        }
        
        // 软超时：返回中间状态，解除阻塞让AI可以继续
        const elapsed = Date.now() - startTime;
        if (elapsed > SOFT_TIMEOUT) {
            const waitMinutes = Math.round(elapsed / 60000);
            return {
                content: [{
                    type: 'text',
                    text: `⏳ 已等待 ${waitMinutes} 分钟，用户尚未响应。\n\n` +
                          `如需继续等待用户反馈，请再次调用 panel_feedback 工具。\n` +
                          `或者你可以继续其他对话。`
                }]
            };
        }
        
        await sleep(POLL_INTERVAL);
    }
    
    throw new Error('Poll timeout after 7 days');
}

// 写调试日志
function writeDebugLog(content) {
    try {
        const logFile = path.join(REGISTRY_DIR, 'debug.log');
        if (!fs.existsSync(REGISTRY_DIR)) {
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
        }
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] ${content}\n`);
    } catch (e) {
        // ignore
    }
}

// 处理 tools/call 请求
async function handleToolCall(mcpId, params) {
    const requestId = generateRequestId();
    const targetPort = getTargetPort();
    
    writeDebugLog(`>>> Tool call: port=${targetPort}, requestId=${requestId}`);
    
    // 1. 提交请求
    const submitResult = await sendRequest('/submit', {
        requestId,
        params
    }, targetPort);
    
    if (submitResult._connectionRefused) {
        return {
            jsonrpc: '2.0',
            id: mcpId,
            error: {
                code: -32000,
                message: '扩展未启动。请先在 IDE 中打开 Panel Feedback 面板。'
            }
        };
    }
    
    if (submitResult.error) {
        return {
            jsonrpc: '2.0',
            id: mcpId,
            error: { code: -32000, message: submitResult.error }
        };
    }
    
    // 2. 轮询等待结果
    try {
        const result = await pollForResult(requestId, targetPort);
        return {
            jsonrpc: '2.0',
            id: mcpId,
            result
        };
    } catch (err) {
        return {
            jsonrpc: '2.0',
            id: mcpId,
            error: { code: -32000, message: err.message }
        };
    }
}

function respond(response) {
    const output = JSON.stringify(response);
    writeDebugLog(`<<< SENDING: id=${response.id}`);
    process.stdout.write(output + '\n');
}

// 处理标准输入
rl.on('line', async (line) => {
    writeDebugLog(`>>> RECV: ${line.substring(0, 100)}...`);
    try {
        const request = JSON.parse(line);
        const { id, method, params } = request;
        
        let response;
        
        if (method === 'initialize') {
            response = {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'panel-feedback', version: '2.0.0' },
                    capabilities: { tools: {} }
                }
            };
        }
        else if (method === 'tools/list') {
            response = {
                jsonrpc: '2.0',
                id,
                result: {
                    tools: [{
                        name: 'panel_feedback',
                        description: '在 IDE 侧边栏显示消息并获取用户反馈，支持预定义选项和图片上传',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                message: {
                                    type: 'string',
                                    description: '要显示给用户的消息，支持 Markdown 格式'
                                },
                                predefined_options: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: '预定义的选项按钮列表'
                                }
                            },
                            required: ['message']
                        }
                    }]
                }
            };
        }
        else if (method === 'notifications/initialized') {
            return;  // 通知类请求不需要响应
        }
        else if (method === 'tools/call' && params?.name === 'panel_feedback') {
            response = await handleToolCall(id, params);
        }
        else {
            response = { jsonrpc: '2.0', id, result: {} };
        }
        
        respond(response);
        
    } catch (err) {
        respond({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: ' + err.message }
        });
    }
});

process.stderr.write('panel-feedback MCP wrapper started\n');
