---
name: kb
description: Manage personal legal knowledge base. Use when user says '查看知识库', '管理知识', '我的知识', '知识记录', '知识库' or similar.
---

# 知识库管理

当用户想查看或管理个人知识库时：
1. 调用 knowledge-server 的 `list_knowledge` 工具获取所有个人知识
2. 按类型（法条/判例/笔记）分组展示
3. 用户想搜索时，调用 `search_knowledge` 工具
4. 用户想删除时，调用 `delete_knowledge` 工具
5. 展示总量和最近添加的条目

## 展示格式
📚 你的个人知识库（共 N 条）
├─ 📖 法条引用：X 条
├─ ⚖️ 类案参考：Y 条
└─ 📝 个人笔记：Z 条

最近添加：...

## 知识统计
- 总使用频次：N 次
- 最常用法条：民法典第X条（N 次引用）
