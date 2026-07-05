#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { VecStore } from './vec-store.js';
import { BaseStore } from './base-store.js';
import { PersonalStore } from './personal-store.js';
import { UserProfileStore } from './user-profile.js';
import { TOOLS } from './types.js';
import { getEmbeddingService } from './embed.js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const PROJECT_ROOT = join(__dirname, '../../..');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'knowledge.db');
const SEED_PATH = join(DATA_DIR, 'seed.db');
const UPDATE_CHECK_PATH = join(DATA_DIR, '.last-update-check');
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

// ===== 工具参数 Schema =====

const SearchSchema = z.object({
  query: z.string().min(1, 'query 不能为空'),
  type: z.string().optional(),
  limit: z.number().int().positive().max(50).optional().default(10),
});

const StoreSchema = z.object({
  title: z.string().min(1, 'title 不能为空'),
  content: z.string().min(1, 'content 不能为空'),
  type: z.string().optional().default('personal_note'),
  tags: z.array(z.string()).optional().default([]),
  reference: z.string().optional(),
  similarityThreshold: z.number().min(0).max(1).optional().default(0.9),
  metadata: z.any().optional(),
});

const ListSchema = z.object({
  type: z.string().optional(),
});

const DeleteSchema = z.object({
  id: z.string().min(1, 'id 不能为空'),
});

const LogConversationSchema = z.object({
  caseType: z.string().min(1, 'caseType 不能为空'),
  question: z.string().min(1, 'question 不能为空'),
  topics: z.array(z.string()).optional().default([]),
  laws: z.array(z.string()).optional().default([]),
  stored: z.boolean().optional().default(false),
});

// ===== 自动检查 seed.db 更新 =====

function shouldCheckUpdate(): boolean {
  if (!existsSync(UPDATE_CHECK_PATH)) return true;
  try {
    const last = parseInt(readFileSync(UPDATE_CHECK_PATH, 'utf-8').trim());
    return Date.now() - last > UPDATE_INTERVAL_MS;
  } catch {
    return true;
  }
}

async function autoUpdateSeed(): Promise<boolean> {
  if (!shouldCheckUpdate()) return false;
  writeFileSync(UPDATE_CHECK_PATH, String(Date.now()));

  try {
    execSync('git fetch origin main --quiet', { cwd: PROJECT_ROOT, timeout: 10000, stdio: 'pipe' });
  } catch {
    return false;
  }

  let remoteSha: string, localSha: string;
  try {
    remoteSha = execSync(
      'git ls-tree origin/main -- mcp/knowledge-server/data/seed.db',
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' },
    ).trim().split(/\s+/)[2] || '';
    localSha = execSync(
      'git ls-tree HEAD -- mcp/knowledge-server/data/seed.db',
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' },
    ).trim().split(/\s+/)[2] || '';
  } catch {
    return false;
  }

  if (remoteSha === localSha) {
    console.error('[update] 知识库已是最新');
    return false;
  }

  console.error('[update] 发现 seed.db 更新，正在同步...');
  try {
    execSync('git fetch origin main --quiet --depth=1', { cwd: PROJECT_ROOT, timeout: 15000, stdio: 'pipe' });
    execSync('git checkout origin/main -- mcp/knowledge-server/data/seed.db', {
      cwd: PROJECT_ROOT, timeout: 5000, stdio: 'pipe',
    });
  } catch (e) {
    console.error('[update] 拉取 seed.db 失败: ' + e);
    return false;
  }

  console.error('[update] ✅ seed.db 已更新');
  return true;
}

// ===== 知识库初始化 =====

// VecStore 实例（knowledge.db 专用，存个人数据）
const store = new VecStore(DB_PATH);

// BaseStore 直接读 seed.db（只读）
const baseStore = new BaseStore(SEED_PATH);
const personalStore = new PersonalStore(store);
const profileStore = new UserProfileStore(DB_PATH);

// ===== 启动时预热嵌入模型（避免首次查询等待下载） =====
await autoUpdateSeed();
console.error('[启动] 预热嵌入模型...');
try {
  const svc = getEmbeddingService();
  await svc.init();
  console.error('[启动] 嵌入模型预热完成');
  // 检查并执行向量迁移（旧版 seed.db 维度迁移）
  if (store.needsReindexCount > 0 || baseStore.needsReindexCount > 0) {
    console.error('[启动] 检测到向量维度变更，重新索引知识库...');
    const storeCount = await store.reindexVectors();
    const seedCount = await baseStore.reindexVectors();
    console.error(`[启动] 重新索引完成: 个人库 ${storeCount} 条, 公共库 ${seedCount} 条`);
  }
} catch (e) {
  console.error('[启动] 嵌入模型预热失败: ' + e);
  console.error('[启动] 将降级运行：向量搜索和存储功能不可用');
}

// ===== MCP Server =====

const server = new Server(
  { name: 'lawyer-knowledge-server', version: '2.0.0' },
  {
    capabilities: { tools: {} },
    instructions: [
      '【必须遵守】每次回答用户法律问题前，先调用 get_user_profile 获取用户画像，回答中自然引用用户常关注的案由或话题。',
      '【必须遵守】每次回答用户法律问题前，必须先调用 search_knowledge 搜索已有知识作为参考。',
      '【禁止】不要用 sqlite3 或其他工具直接查询 seed.db/knowledge.db。所有知识检索只通过 search_knowledge 完成。',
      '【外部数据】一般法律问题可以获取最新 LPR 等公开数据辅助回答；案件分析场景严格以用户文书为准，禁止外部数据。',
      '【必须遵守】每次回答完用户问题后，必须调用 store_knowledge 存储知识点，再调用 log_conversation 记录本次交互。',
      '【重要】store_knowledge 仅用于存储提炼后的法律知识点。对于案件分析场景：只有用户提供了生效法律文书（判决书/裁定书/调解书）时才存入知识库；用户仅描述案情或咨询时，不存储。',
      '【必须遵守】只回答民事诉讼相关问题，非民事问题拒绝回答。',
    ].join('\n'),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOLS.SEARCH,
      description: '语义搜索知识库，自动理解查询含义。搜「借钱不还」也能匹配到民间借贷类内容',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' },
          type: { type: 'string', description: '知识类型: law/case/term/template/case_analysis/personal_note' },
          limit: { type: 'number', description: '返回结果数，默认10，最大50' },
        },
        required: ['query'],
      },
    },
    {
      name: TOOLS.STORE,
      description: '存入一条提炼后的法律知识点到个人知识库',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '知识点标题' },
          content: { type: 'string', description: '知识点内容（含用户问题和法律分析）' },
          type: { type: 'string', description: '知识类型: law/case/term/case_analysis/personal_note，默认personal_note' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          reference: { type: 'string', description: '法条/案号等引用来源' },
          similarityThreshold: { type: "number", description: "去重阈值 0-1，默认0.9，值越低越容易去重" },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: TOOLS.LIST,
      description: '列出个人知识库中的所有知识点摘要',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '按类型筛选: law/case/term/template/case_analysis/personal_note' },
        },
      },
    },
    {
      name: TOOLS.DELETE,
      description: '删除个人知识库中的一条知识点',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '知识条目ID' } },
        required: ['id'],
      },
    },
    {
      name: TOOLS.LOG_CONVERSATION,
      description: '记录一次用户的法律咨询交互，用于分析用户关注点和执业画像',
      inputSchema: {
        type: 'object',
        properties: {
          caseType: { type: 'string', description: '案由分类（借贷/合同/离婚/继承/侵权/其他）' },
          question: { type: 'string', description: '用户问题摘要' },
          topics: { type: 'array', items: { type: 'string' }, description: '涉及话题标签' },
          laws: { type: 'array', items: { type: 'string' }, description: '引用的法条' },
          stored: { type: 'boolean', description: '是否已存入知识库' },
        },
        required: ['caseType', 'question'],
      },
    },
    {
      name: TOOLS.GET_PROFILE,
      description: '获取用户执业画像：案由分布、高频法条、关注话题等，用于在回答中个性化引用',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: TOOLS.EXPORT,
      description: '导出个人知识库全部内容为 JSON 格式',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs ?? {};

  try {
    switch (name) {
      case TOOLS.SEARCH: {
        const { query, type, limit } = SearchSchema.parse(args);
        const startTime = Date.now();
        const [baseResults, personalResults] = await Promise.all([
          baseStore.search(query, type, limit),
          personalStore.search(query, type, limit),
        ]);
        const all = [...baseResults, ...personalResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              results: all,
              totalBase: baseStore.count(),
              totalPersonal: personalStore.count(),
              timeMs: Date.now() - startTime,
            }, null, 2),
          }],
        };
      }

      case TOOLS.STORE: {
        const { title, content, type, tags, reference, similarityThreshold } = StoreSchema.parse(args);
        const id = `personal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();

        // 预计算嵌入向量，findSimilar 和 add 共用，避免两次模型推理
        const svc = getEmbeddingService();
        const embedding = await svc.embed(title + ' ' + content);

        const existing = await personalStore.findSimilar(title, content, type, similarityThreshold, embedding);
        if (existing) {
          personalStore.incrementUsage(existing.item.id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                saved: false,
                matched: existing.item.id,
                message: '已有相似条目，已增加引用计数',
              }),
            }],
          };
        }

        await personalStore.add({
          id,
          type: type as any,
          title,
          content,
          tags,
          reference: reference || undefined,
          source: 'extract',
          createdAt: now,
          updatedAt: now,
          usageCount: 1,
          metadata: '{}',
        }, embedding);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ saved: true, id, title, message: '已存入个人知识库' }),
          }],
        };
      }

      case TOOLS.LIST: {
        const { type } = ListSchema.parse(args);
        const items = personalStore.getAll(type as any);
        const byType = personalStore.vecStore.countByType();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: items.length,
              byType,
              items: items.slice(0, 50).map(i => ({
                id: i.id,
                title: i.title,
                type: i.type,
                tags: typeof i.tags === 'string' ? JSON.parse(i.tags) : (i.tags || []),
                usageCount: i.usageCount,
                createdAt: i.createdAt,
              })),
            }, null, 2),
          }],
        };
      }

      case TOOLS.DELETE: {
        const { id } = DeleteSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: personalStore.delete(id) }) }] };
      }

      case TOOLS.LOG_CONVERSATION: {
        const { caseType, question, topics, laws, stored } = LogConversationSchema.parse(args);
        const logId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await profileStore.log({
          id: logId,
          date: new Date().toISOString(),
          caseType,
          question,
          topics,
          laws,
          stored,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ saved: true, id: logId }) }] };
      }

      case TOOLS.GET_PROFILE: {
        const profile = profileStore.getProfile();
        return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }] };
      }

      case TOOLS.EXPORT: {
        const allItems = personalStore.getAll();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              exportedAt: new Date().toISOString(),
              total: allItems.length,
              items: allItems.map(i => ({
                id: i.id,
                type: i.type,
                title: i.title,
                content: i.content,
                tags: typeof i.tags === 'string' ? JSON.parse(i.tags) : (i.tags || []),
                reference: i.reference,
                source: i.source,
                createdAt: i.createdAt,
                updatedAt: i.updatedAt,
                usageCount: i.usageCount,
              })),
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (err) {
    // 区分验证错误和运行时错误
    if (err instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: '参数验证失败',
            details: err.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`),
          }),
        }],
        isError: true,
      };
    }
    throw err;
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('📚 律师知识库 MCP Server v2 已启动（seed.db + knowledge.db）');
