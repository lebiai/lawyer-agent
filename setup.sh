#!/usr/bin/env bash
set -euo pipefail

echo "🔧 正在安装律师助手..."

if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js (>=18)"
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. 编译 MCP Server
cd "$PROJECT_DIR/mcp/knowledge-server"
npm install
npm run build

# 2. 注册 MCP Server 到全局 Codex 配置（避免项目信任问题）
CODEX_CONFIG="$HOME/.codex/config.toml"
SERVER_NAME="lawyer-knowledge-server"
SERVER_PATH="$PROJECT_DIR/mcp/knowledge-server/dist/server.js"

if [ -f "$CODEX_CONFIG" ]; then
    # 检查是否已注册
    if grep -q "$SERVER_NAME" "$CODEX_CONFIG" 2>/dev/null; then
        echo "✅ MCP Server 已注册，跳过"
    else
        # 追加到全局配置
        cat >> "$CODEX_CONFIG" << EOF

[mcp_servers.$SERVER_NAME]
command = "node"
args = ["$SERVER_PATH"]
startup_timeout_sec = 30
EOF
        echo "✅ MCP Server 已注册到全局 ~/.codex/config.toml"
    fi
else
    # 创建全局配置
    mkdir -p "$HOME/.codex"
    cat > "$CODEX_CONFIG" << EOF
[mcp_servers.$SERVER_NAME]
command = "node"
args = ["$SERVER_PATH"]
startup_timeout_sec = 30
EOF
    echo "✅ 已创建 ~/.codex/config.toml 并注册 MCP Server"
fi

echo ""
echo "🎉 律师助手安装完成！"
echo ""
echo "下一步："
echo "1. 关闭当前 Thread"
echo "2. 新建一个 Thread 开始使用"
echo "3. 例如：「民间借贷的利率上限是多少？」"
echo "4. 输入「查看知识库」浏览知识图谱"
