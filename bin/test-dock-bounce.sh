#!/bin/bash
# 测试 Dock 跳动功能
# 用法: chmod +x test-dock-bounce.sh && ./test-dock-bounce.sh

echo "🔧 正在编译 dock-bounce..."

cd "$(dirname "$0")"

# 编译 Swift 代码
swiftc -o dock-bounce dock-bounce.swift 2>&1

if [ $? -eq 0 ]; then
    echo "✅ 编译成功！"
    echo ""
    echo "⚠️  请先切换到其他应用窗口（比如 Finder），然后观察 Dock 中的 Terminal/终端 图标"
    echo "⏳ 5秒后开始测试..."
    sleep 5
    
    echo "🚀 开始测试 Dock 跳动..."
    ./dock-bounce
else
    echo "❌ 编译失败，请检查是否安装了 Xcode Command Line Tools"
    echo "   运行: xcode-select --install"
fi
