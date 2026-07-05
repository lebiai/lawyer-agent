# 工具脚本

## 知识图谱可视化

```bash
# 生成知识图谱页面
python3 scripts/generate-viz.py

# 如果只想看公共知识库或只想看个人知识库：
python3 scripts/generate-viz.py --no-kb    # 只看 seed.db
python3 scripts/generate-viz.py --no-seed  # 只看 knowledge.db
```

生成后双击 `kb-viz.html` 即可在浏览器中查看。

## 编译种子数据（供应商专用）

```bash
node mcp/knowledge-server/scripts/build-seed.mjs
```
