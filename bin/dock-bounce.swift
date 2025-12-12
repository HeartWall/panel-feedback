#!/usr/bin/env swift
// dock-bounce.swift
// 触发 macOS Dock 图标跳动
// 用法: swiftc -o dock-bounce dock-bounce.swift && ./dock-bounce

import AppKit

// 创建一个隐藏的 NSApplication 实例
let app = NSApplication.shared

// 请求用户注意力 - 这会触发 Dock 图标跳动
// .criticalRequest = 持续跳动直到用户切换到该应用
// .informationalRequest = 只跳动一次
let requestId = NSApp.requestUserAttention(.criticalRequest)

print("🔔 Dock 图标正在跳动... (3秒后停止)")

// 3秒后取消跳动并退出
DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
    NSApp.cancelUserAttentionRequest(requestId)
    print("✅ 已停止跳动")
    exit(0)
}

// 运行事件循环
RunLoop.main.run()
