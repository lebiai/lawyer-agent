#!/usr/bin/env bash
set -euo pipefail

echo "🔧 正在安装律师助手..."

if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js (>=18)"
    exit 1
fi

cd "$(dirname "$0")/mcp/knowledge-server"

npm install
npm run build

echo "✅ 律师助手安装完成！"
echo ""
echo "下一步："
echo "1. 关闭当前 Thread，新建一个 Thread 开始使用"
echo "2. 例如：「民间借贷的利率上限是多少？」"
