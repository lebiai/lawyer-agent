---
name: kb
description: View personal legal knowledge graph. Use when user says '查看知识库', '知识图谱', '可视化', '我的知识', '知识库' or similar.
---

# 知识库可视化

当用户说「查看知识库」或类似指令时，执行以下两步，**不要做任何多余操作**：

## 步骤

1. **生成可视化 HTML**
   
   运行以下命令，生成知识图谱页面（只包含用户个人知识）：
   ```
   python3 scripts/generate-viz.py
   ```

2. **打开页面**
   
   运行以下命令，用系统默认浏览器打开：
   ```
   open kb-viz.html
   ```

## 重要规则

- ⚠️ **不要使用任何浏览器自动化工具**（不要用 Playwright、browser、Computer Use、截图等）
- ⚠️ **不要启动 HTTP 服务器**
- ⚠️ **不要做任何额外的操作或询问用户**
- 只执行以上两个命令，完成即止
