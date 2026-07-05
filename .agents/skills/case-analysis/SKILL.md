---
name: case-analysis
description: >
  In-depth analysis of court judgments and legal documents. Use when user uploads or pastes a judgment document (verdict/ruling/mediation), or says '帮我分析这个案子', '分析判决书', '案件深度分析' with a legal document attached.
---

# 案件深度分析 Skill

用户上传或粘贴法院裁判文书并请求分析时执行。从 10 个维度以模块化步骤输出结构化报告。

## 触发条件
- 用户上传/粘贴了法院裁判文书并请求分析
- 用户说"帮我分析这个案子"并附带了文书内容

## 工作流

```
Step 1: 读取用户上传的文件/粘贴的文字
Step 2: 调用 get_user_profile 了解律师偏好（如有）
Step 3: 调用 search_knowledge 搜索相似案由的已有知识
Step 4: 按 workflow/01~10 顺序逐维度分析判决书
Step 5: 按 output/template.md 输出完整报告
Step 6: 逐条核对原文（rules/quality-control.md）
Step 7: 归档判断：仅生效法律文书才 store_knowledge(type: case_analysis)
Step 8: 无论是否归档，都 log_conversation 记录本次交互
```

## 分析维度（10 个模块）

| # | 维度 | 说明 |
|:-:|------|------|
| 1 | 案件基本信息 | 案号、案由、法院、审判程序、代理律师等 |
| 2 | 争议焦点 | 核心争议、事实摘要 |
| 3 | 诉讼动机分析 | 导火索、诉求与真实动机、被告立场 |
| 4 | 证据链分析 | 逐条分析双方证据，评估采信状态和权重 |
| 5 | 法律路径 | 法院的每条法律推理路径单独分析 |
| 6 | 推理链条 | 法院从事实到法律适用的完整思维脉络 |
| 7 | 关键转折点 | 影响案件走向的关键事件 |
| 8 | 法官裁判倾向 | 裁判风格、证据采信偏好 |
| 9 | 模式标签 | 标准化短标签（事实/证据/策略模式） |
| 10 | 实战启示 | 当事人怎么做、律师怎么用、风险预警 |

## 约束规则

| 场景 | 文件 |
|------|------|
| 证据分类/清洗/采信评价 | rules/evidence-rules.md |
| 法条引用格式 | rules/law-citation.md |
| 质量约束/反例/自查 | rules/quality-control.md |

## 归档规则
- 用户提供了**生效法律文书**（判决书/裁定书/调解书）→ `store_knowledge(type: case_analysis)`
- 仅描述案情或咨询 → 不存入，`log_conversation(stored: false)`

## 个性化
- 分析前调用 `get_user_profile` 了解律师关注领域
- 回复末尾：📎 案件分析已存入知识库 / 💡 本次分析未归档
