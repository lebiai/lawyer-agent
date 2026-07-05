# 模块：更新用户画像

分析完成后调用 `log_conversation` 更新用户交互记录：

- caseType: 案由
- question: 案情摘要
- topics: 案件涉及的话题（含模式标签）
- laws: 引用的法条
- stored: 是否已存入知识库

每次分析后的 `log_conversation` 调用会逐步丰富用户画像，下次回答时可参考 `get_user_profile` 的结果。
