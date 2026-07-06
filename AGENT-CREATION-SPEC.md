# 🧬 Codex Agent 创造规范

> 基于律师助手的实践经验，提炼出的**跨行业通用 Agent 构建规范**。
> 按此规范，可为医疗、教育、金融、法律等任意行业打造专属 AI 智能体。

---

## 一、核心理念

### 1.1 三层架构

```
┌───────────────────────────────────────┐
│         第一层：行为规则层              │
│  AGENTS.md — Agent 的"宪法"           │
│  定义：职责边界、回答规则、工作流      │
├───────────────────────────────────────┤
│         第二层：能力层                  │
│  Skills — 可执行的领域能力              │
│  定义：每个技能的工作流、输入输出、约束  │
├───────────────────────────────────────┤
│         第三层：基础设施层              │
│  MCP Server — 知识引擎                  │
│  定义：存储、检索、画像、推理           │
└───────────────────────────────────────┘
```

### 1.2 核心原则

| 原则 | 说明 | 示例 |
|------|------|------|
| **宪法先行** | AGENTS.md 是一切行为的根本约束 | "只回答民事问题" |
| **能力可执行** | 每个 Skill 有明确的触发词和步骤 | "帮我分析这个案子" |
| **知识自成长** | 每次交互自动提炼知识点存入库 | 从回答中提取法条 |
| **双库分离** | 公共库（只读）+ 个人库（读写） | seed.db + knowledge.db |
| **零配置部署** | 一个 GitHub 地址 + 一句话完成安装 | "帮我安装 xxxx" |

---

## 二、第一层：行为规则层（AGENTS.md）

### 2.1 规范结构

```
AGENTS.md 必须包含以下章节：

## 核心原则           ← 职责边界、回答规则、禁止事项
## 首次使用引导       ← 用户第一次使用时的简短提示
## [核心能力]         ← 每个核心能力的详细工作流
## 回答前：搜索知识库 ← 检索规则（必须用向量搜索，禁止直接查库）
## 回答中：个性化引用 ← 用户画像的使用规则
## 回答后：归档知识   ← 存储规则 + 对话记录规则
## 自动更新           ← 知识库更新机制
## 安装指引           ← 用户自助安装流程
```

### 2.2 模板

```markdown
# [行业] AI 助手 — 工作规范

## 核心原则
- 只回答 [领域] 相关问题
- 非 [领域] 问题一律不回答，回复：「...」
- 回答必须引用 [行业标准/法规]

## 回答前：搜索知识库
必须调用 search_knowledge 搜索已有知识。
禁止直接 sqlite3 查询 database。

## 回答后：归档知识
两步操作，缺一不可：
1. 调用 store_knowledge — 存储提炼后的知识点
2. 调用 log_conversation — 记录交互（用于用户画像）

## 自动更新
知识库在每次 Thread 启动时自动检查更新。

## 安装指引
用户说「帮我安装 [URL]」时的处理流程
```

### 2.3 关键约束规则

| 规则类型 | 律师示例 | 通用化 |
|----------|---------|--------|
| 领域边界 | 只回答民事诉讼 | 只回答 [行业] 相关问题 |
| 检索强制 | 必须用 search_knowledge | 必须通过 MCP tools 检索，禁止直连数据库 |
| 归档强制 | 回答后必须 store_knowledge | 每次交互后必须存入提炼的知识点 |
| 数据来源 | 案件分析禁止使用外部数据 | 关键分析场景禁止外部数据污染 |
| 引用规则 | 自然引用用户画像 | 在强关联时才引入个性化信息 |

---

## 三、第二层：能力层（Skills）

### 3.1 Skill 规范结构

```
.agents/skills/[skill-name]/
├── SKILL.md              # 主文件：触发词、工作流、输出格式
├── modules/              # 子模块（可选）
│   ├── step-1.md
│   └── step-2.md
└── rules/                # 质量规则（可选）
        ├── rule-1.md
        └── rule-2.md
```

### 3.2 SKILL.md 模板

```yaml
---
name: [技能名]
description: >
  [一句话说明何时触发]
---

# [技能名称]

当用户说出 [触发短语] 时执行。

## 工作流

```
Step 1: [步骤1]
Step 2: [步骤2]
Step 3: 调用 store_knowledge（如适用）
Step 4: 调用 log_conversation
```

## 输出格式

```
══════════════════════════
📋 [标题]
══════════════════════════

一、[章节1] ✔
  [内容]

二、[章节2] ✔
  [内容]
══════════════════════════
```

## ⚠️ 自查清单
- [ ] 清单1
- [ ] 清单2
```

### 3.3 Skill 设计原则

| 原则 | 说明 |
|------|------|
| **单一职责** | 一个 Skill 只做一件事（如：案件分析、知识查看） |
| **完整工作流** | 必须包含搜索 → 分析 → 归档 → 记录 的完整闭环 |
| **可验证输出** | 每个输出维度用 ✔ 标记，方便自查遗漏 |
| **触发词明确** | description 写清楚用户说什么话时会触发 |
| **模块化规则** | 复杂规则分离到 rules/ 目录，避免 SKILL.md 过长 |

---

## 四、第三层：基础设施层（MCP Server）

### 4.1 知识库架构

```
┌────────────────────────────────────────────────┐
│                   MCP Server                    │
│                                                 │
│   ┌──────────────┐    ┌──────────────────┐      │
│   │   BaseStore   │    │  PersonalStore   │      │
│   │  (seed.db)    │    │ (knowledge.db)   │      │
│   │  只读公共库   │    │  读写个人库      │      │
│   └──────────────┘    └──────────────────┘      │
│          │                      │                │
│          └────────┬─────────────┘                │
│                   │                              │
│            ┌──────▼──────┐                       │
│            │   VecStore   │                      │
│            │  向量引擎     │                      │
│            │ sqlite-vec   │                      │
│            └─────────────┘                       │
│                   │                              │
│            ┌──────▼──────┐                       │
│            │   Embedding  │                      │
│            │  bge-base-zh │                      │
│            └─────────────┘                       │
└────────────────────────────────────────────────┘
```

### 4.2 MCP Tools 定义

每个 Agent 的 MCP Server 必须暴露以下工具：

| 工具名 | 功能 | 必须/可选 |
|--------|------|-----------|
| `search_knowledge` | 向量语义搜索（同时查公共+个人库） | ✅ 必须 |
| `store_knowledge` | 存储知识点（含去重、向量化） | ✅ 必须 |
| `list_knowledge` | 列出知识条目 | ✅ 必须 |
| `delete_knowledge` | 删除知识条目 | ✅ 必须 |
| `log_conversation` | 记录交互日志（用于画像） | ✅ 必须 |
| `get_user_profile` | 获取用户画像 | ✅ 必须 |
| `export_knowledge` | 导出个人知识 | 可选 |

### 4.3 嵌入模型选择策略

| 场景 | 推荐模型 | 大小 | 维度 |
|------|----------|------|------|
| 中文通用 | `bge-base-zh-v1.5` | ~100MB | 768 |
| 英文为主 | `all-MiniLM-L6-v2` | ~80MB | 384 |
| 高精度 | `bge-large-zh-v1.5` | ~330MB | 1024 |
| 多语言 | `intfloat/multilingual-e5-small` | ~120MB | 384 |

### 4.4 数据库设计

```sql
-- 知识条目表
CREATE TABLE knowledge (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,      -- 行业自定义类型
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  reference   TEXT,               -- 来源/引用
  source      TEXT DEFAULT 'manual',  -- seed/extract/manual
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  metadata    TEXT DEFAULT '{}'   -- 扩展字段
);

-- 向量索引表（由 sqlite-vec 管理）
CREATE VIRTUAL TABLE knowledge_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[768]            -- 维度与模型匹配
);

-- 标签索引
CREATE TABLE tag_index (
  tag   TEXT NOT NULL,
  kb_id TEXT NOT NULL
);

-- 对话日志表
CREATE TABLE conversations (
  id        TEXT PRIMARY KEY,
  date      TEXT NOT NULL,
  case_type TEXT NOT NULL,       -- 行业分类
  question  TEXT NOT NULL,
  topics    TEXT NOT NULL DEFAULT '[]',
  laws      TEXT NOT NULL DEFAULT '[]',
  stored    INTEGER DEFAULT 0
);
```

---

## 五、知识自成长闭环

这是 Agent 的**核心卖点**，也是与普通 AI 问答的本质区别。

```
                    ┌─────────────────────┐
                    │    用户提问          │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   search_knowledge   │  ← 检索已有知识
                    │   (公共库 + 个人库)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   get_user_profile   │  ← 获取用户画像
                    │   (个性化引用)        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    AI 回答问题       │
                    │   + 引用知识库       │
                    │   + 个性化关联      │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼───────────────┐
               │               │               │
    ┌──────────▼──────────┐ ┌─▼─────────────▼─┐
    │   store_knowledge   │ │ log_conversation │
    │   (存入提炼的知识点) │ │ (记录交互日志)   │
    └─────────────────────┘ └─────────────────┘
               │
               ▼
       知识库越来越厚
       回答越来越精准
```

### 5.1 归档策略

| 条件 | 是否存储 | 存储内容 |
|------|----------|----------|
| 用户问了一般法律问题 | ✅ 存储 | 提炼后的知识点（法条、术语） |
| 用户上传生效文书要求分析 | ✅ 存储 | 完整分析报告 |
| 用户仅口头咨询案情 | ❌ 不存储 | 仅记录对话日志 |
| 用户闲聊/非领域问题 | ❌ 不存储 | 不记录 |

### 5.2 用户画像维度

```typescript
interface UserProfile {
  totalConversations: number;           // 总对话数
  totalKnowledge: number;               // 知识库条目数
  caseTypeDistribution: Record<string, number>;  // 关注领域分布
  topLaws: Array<{ law: string; count: number }>;  // 常用法规
  topTopics: Array<{ topic: string; count: number }>;  // 关注话题
  lastWeekCount: number;                // 近一周活跃度
  knowledgeGrowth: number;              // 知识增长数
}
```

---

## 六、安装与分发体系

### 6.1 用户安装流程

```
Step 1: 打开 Codex 桌面端
Step 2: 点「+ New Project」→ 选空文件夹
Step 3: 新建 Thread
Step 4: 说「帮我安装 https://github.com/你/agent」
Step 5: ✅ 自动完成所有配置
```

### 6.2 安装脚本规范（setup.mjs）

```javascript
// setup.mjs 必须完成：
// 1. 检查 Node.js 版本
// 2. npm install → 安装依赖
// 3. npm rebuild native modules → 编译原生模块
// 4. macOS codesign → 签名（macOS only）
// 5. npm run build → 编译 TypeScript
// 6. 生成 .codex/config.toml → 注册 MCP Server
// 7. 预下载嵌入模型 → 避免首次超时
// 8. 输出完成提示
```

### 6.3 仓库结构规范

```
├── AGENTS.md              # Agent 宪法
├── setup.mjs              # 跨平台安装脚本
├── .codex/
│   ├── config.toml        # MCP Server 注册
│   └── hooks.json         # 生命周期钩子
├── .agents/skills/        # 技能定义
│   └── [skill-name]/
│       ├── SKILL.md
│       ├── modules/
│       └── rules/
├── mcp/[server-name]/     # MCP Server
│   ├── src/
│   ├── data/
│   │   ├── seed.db        # 🌱 公共知识库（纳入版本管理）
│   │   └── knowledge.db   # 🔒 个人知识库（.gitignore）
│   └── scripts/
└── scripts/
```

---

## 七、跨行业适配指南

### 7.1 替换清单

| 组件 | 律师版 | 医疗版示例 | 金融版示例 |
|------|--------|-----------|-----------|
| AGENTS.md 领域边界 | 民事诉讼 | 常见病诊疗 | 个人理财 |
| knowledge type | law/case/term | disease/drug/protocol | product/regulation/strategy |
| seed.db 内容 | 民法典+判例 | 药典+诊疗指南 | 监管法规+产品库 |
| 核心 Skill | 案件分析 | 症状诊断 | 投资分析 |
| 用户画像维度 | 案由分布 | 病症分布 | 产品偏好 |
| 嵌入模型 | bge-base-zh-v1.5 | bge-base-zh-v1.5 | bge-base-zh-v1.5 |

### 7.2 知识库类型映射

```
律师: law | case | term | template | case_analysis | personal_note
医疗: disease | drug | protocol | template | diagnosis | personal_note
金融: product | regulation | strategy | template | analysis | personal_note
教育: subject | exercise | method | template | evaluation | personal_note
法律: statute | precedent | term | template | opinion | personal_note
```

### 7.3 开发步骤

```
1️⃣ 搭建基础框架
   git init → 目录结构 → AGENTS.md 模板

2️⃣ 构建 MCP Server
   TypeScript 模板 → 修改 knowledge type → 调整搜索/存储逻辑

3️⃣ 准备公共知识库（seed.db）
   收集行业数据 → JSON 结构化 → build-seed.mjs 构建 → 纳入 git

4️⃣ 编写核心 Skills
   行业核心能力分析 → 拆分 Skills → 编写 SKILL.md → 绑定 MCP tools

5️⃣ 配置安装流程
   setup.mjs → 依赖安装 → 模型配置 → 测试

6️⃣ 验证闭环
   提问 → search_knowledge → 回答 → store_knowledge → log_conversation → 再次搜索能否命中
```

---

## 八、质量保障

### 8.1 必须通过的验证项

| 检查项 | 验证方式 | 通过标准 |
|--------|----------|----------|
| MCP Server 启动 | `node dist/server.js` | 3 秒内输出启动日志 |
| 嵌入模型加载 | 启动日志 | 显示模型维度 |
| 向量搜索 | search_knowledge | 返回相关结果 |
| 知识存储 | store_knowledge | 存入后 search 能命中 |
| 用户画像 | get_user_profile | 返回非空统计数据 |
| 知识导出 | export_knowledge | 导出完整的 JSON |
| Skills 触发 | 输入触发词 | 正确执行工作流 |
| 非领域拒绝 | 输入非领域问题 | 返回预设回复 |
| 安装脚本 | 全新环境运行 setup.mjs | 无报错完成 |

### 8.2 常见陷阱

| 陷阱 | 表现 | 解决方案 |
|------|------|----------|
| 嵌入模型下载超时 | MCP Server 启动卡住 | setup.mjs 预下载 + config.toml 设置 120s 超时 |
| macOS 原生模块签名 | better-sqlite3 报错 | npm rebuild + codesign |
| Windows 路径问题 | 模型缓存目录错误 | 区分 `HOME` 和 `USERPROFILE` |
| ESM import 找不到模块 | generate-viz 报错 | 用 createRequire 显式指定路径 |
| 知识存了但搜不到 | store 正常但 search 为空 | 检查向量维度是否匹配 |
| Hook 事件未触发 | 对话结束不归档 | 检查 hooks.json 格式 |

---

## 九、总结

```
一个 Codex Agent = 
  AGENTS.md（宪法）
  + Skills（能力）
  + MCP Server（知识引擎）
  + setup.mjs（安装器）
  + seed.db（公共知识库）
  + 知识自成长闭环（核心卖点）

三者缺一不可，闭环决定价值。
```
