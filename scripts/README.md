# 知识图谱可视化生成器

## scripts/generate-viz.mjs (推荐)

Node.js 脚本，消除 Python 依赖。从 SQLite 数据库读取知识数据，生成 `kb-viz.html`。

```bash
# 只显示个人知识库（默认）
NODE_PATH=mcp/knowledge-server/node_modules node scripts/generate-viz.mjs

# 同时显示公共知识库
NODE_PATH=mcp/knowledge-server/node_modules node scripts/generate-viz.mjs --with-seed
```

## scripts/generate-viz.py (已废弃)

旧版 Python 脚本，保留供参考。已由 `generate-viz.mjs` 替代。
