#!/usr/bin/env bash
set -euo pipefail

echo "🔧 正在安装律师助手..."

if ! command -v node &> /dev/null; then
    echo "❌ 请先安装 Node.js (>=18)"
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. 安装依赖并编译 MCP Server
cd "$PROJECT_DIR/mcp/knowledge-server"
npm install --silent 2>/dev/null
npm run build

# 2. 注册 MCP Server 到项目本地配置
#    使用项目内 .codex/config.toml，注意：服务器路径写绝对路径
LOCAL_CONFIG="$PROJECT_DIR/.codex/config.toml"
mkdir -p "$(dirname "$LOCAL_CONFIG")"
cat > "$LOCAL_CONFIG" << EOF
[mcp_servers.knowledge-server]
command = "node"
args = ["$PROJECT_DIR/mcp/knowledge-server/dist/server.js"]
startup_timeout_sec = 30
EOF
echo "✅ MCP Server 已注册到项目配置"

# 3. 清理全局配置中可能存在的错误条目（旧版安装遗留）
GLOBAL_CONFIG="$HOME/.codex/config.toml"
if [ -f "$GLOBAL_CONFIG" ]; then
    # 移除误写入 [hooks.state] 下的内容
    if grep -q "lawyer-knowledge-server\|knowledge-server.*dist/server" "$GLOBAL_CONFIG" 2>/dev/null; then
        # macOS sed 需要备份扩展名
        sed -i '' '/lawyer-knowledge-server/d' "$GLOBAL_CONFIG" 2>/dev/null || true
        # 如果 [hooks.state] 段下只剩空字段，删除整个段
        sed -i '' '/^\[hooks\.state\]/,/^\[/{ /^\[hooks\.state\]/d; /^\[/!d; }' "$GLOBAL_CONFIG" 2>/dev/null || true
        echo "✅ 已清理全局配置中的旧条目"
    fi
fi

echo ""
echo "🎉 律师助手安装完成！"
echo ""
echo "下一步："
echo "1. 关闭当前 Thread"
echo "2. 新建一个 Thread 开始使用"
echo "3. 例如：「民间借贷的利率上限是多少？」"
echo "4. 输入「你能做什么」查看全部功能"
