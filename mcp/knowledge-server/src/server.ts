#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VecStore } from './vec-store.js';
import { BaseStore } from './base-store.js';
import { PersonalStore } from './personal-store.js';
import { TOOLS } from './types.js';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'knowledge.db');
const SEED_PATH = join(DATA_DIR, 'seed.db');

/**
 * --build-seed 模式：供应商专用
 * 将 seed/ 目录下的 JSON 编译为 seed.db
 * 使用 scripts/build-seed.mjs 替代
 */
if (process.argv.includes('--build-seed')) {
  console.error('请使用 node scripts/build-seed.mjs 来编译 seed 数据');
  process.exit(1);
}

/**
 * --merge-seed 模式：律师 git pull 后运行
 * 将 seed.db 中的新条目合并到 knowledge.db（按 id 去重，不覆盖已有）
 */
if (process.argv.includes('--merge-seed')) {
  if (!existsSync(SEED_PATH)) {
    console.error('❌ seed.db 不存在，请先运行 --merge-seed 或在 setup 时配备 seed.db');
    process.exit(1);
  }
  const seedStore = new VecStore(SEED_PATH);
  const mainStore = new VecStore(DB_PATH);

  const seedItems = seedStore.getAll();
  let added = 0;
  for (const item of seedItems) {
    // 按 id 去重，已存在则跳过
    const existing = mainStore.getAll().find(i => i.id === item.id);
    if (!existing) {
      await mainStore.add(item);
      added++;
    }
  }
  seedStore.close();
  mainStore.close();
  console.log(`✅ seed 数据合并完成，新增 ${added} 条`);
  process.exit(0);
}

// ===== 正常启动 =====

// 如果 knowledge.db 不存在，从 seed.db 复制
if (!existsSync(DB_PATH)) {
  if (existsSync(SEED_PATH)) {
    copyFileSync(SEED_PATH, DB_PATH);
    console.error('[init] 从 seed.db 初始化 knowledge.db');
  } else {
    console.error('[init] 创建空的 knowledge.db');
  }
}

// 共享 VecStore 实例
const store = new VecStore(DB_PATH);

// 兼容旧版 --init（现在等价于 --merge-seed）
if (process.argv.includes('--init')) {
  if (existsSync(SEED_PATH)) {
    const seedStore = new VecStore(SEED_PATH);
    const seedItems = seedStore.getAll();
    let added = 0;
    for (const item of seedItems) {
      const existing = store.getAll().find(i => i.id === item.id);
      if (!existing) {
        await store.add(item);
        added++;
      }
    }
    seedStore.close();
    console.log(`✅ seed 数据合并完成，新增 ${added} 条`);
  }
  console.log(`✅ Base 库: ${store.count(undefined, 'seed')} 条`);
  console.log(`✅ Personal 库: ${store.count(undefined, 'extract')} 条`);
  process.exit(0);
}

// base-store 直接读 seed.db（只读）
const baseStore = new BaseStore(SEED_PATH);
const personalStore = new PersonalStore(store);

const server = new Server(
  { name: 'lawyer-knowledge-server', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOLS.SEARCH,
      description: '语义搜索知识库，自动理解查询含义。搜「借钱不还」也能匹配到民间借贷类内容',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          type: { type: 'string', description: '筛选类型（可选）' },
          limit: { type: 'number', description: '返回条数上限', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: TOOLS.STORE,
      description: '将结构化知识存入个人知识库，自动生成向量嵌入',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '知识标题' },
          content: { type: 'string', description: '知识内容' },
          type: { type: 'string', description: '知识类型', default: 'personal_note' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          reference: { type: 'string', description: '法条号/案号（如有）' },
          metadata: { type: 'object', description: '扩展元数据' },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: TOOLS.LIST,
      description: '查看个人知识库摘要',
      inputSchema: { type: 'object', properties: { type: { type: 'string' } } },
    },
    {
      name: TOOLS.DELETE,
      description: '删除个人知识库中的条目',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case TOOLS.SEARCH: {
      const { query, type, limit } = args as any;
      const startTime = Date.now();
      const [baseResults, personalResults] = await Promise.all([
        baseStore.search(query, type, limit ?? 10),
        personalStore.search(query, type, limit ?? 10),
      ]);
      const all = [...baseResults, ...personalResults]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 10);
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
      const { title, content, type, tags, reference, metadata } = args as any;
      const id = `personal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();

      const existing = await personalStore.findSimilar(title, content, type || 'personal_note', 0.9);
      if (existing) {
        personalStore.incrementUsage(existing.item.id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ saved: false, matched: existing.item.id, message: '已有相似条目，已增加引用计数' }),
          }],
        };
      }

      await personalStore.add({
        id, type: type || 'personal_note', title, content,
        tags: tags || [], reference: reference || undefined,
        source: 'extract', createdAt: now, updatedAt: now,
        usageCount: 1, metadata: JSON.stringify(metadata || {}),
      } as any);

      return { content: [{ type: 'text', text: JSON.stringify({ saved: true, id, title, message: '已存入个人知识库' }) }] };
    }

    case TOOLS.LIST: {
      const { type } = (args ?? {}) as { type?: string };
      const items = personalStore.getAll(type as any);
      const byType = personalStore.vecStore.countByType();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: items.length, byType,
            items: items.slice(0, 50).map(i => ({
              id: i.id, title: i.title, type: i.type,
              tags: typeof i.tags === 'string' ? JSON.parse(i.tags) : (i.tags || []),
              usageCount: i.usageCount, createdAt: i.createdAt,
            })),
          }, null, 2),
        }],
      };
    }

    case TOOLS.DELETE: {
      const { id } = args as { id: string };
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: personalStore.delete(id) }) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('📚 律师知识库 MCP Server v2 已启动（seed.db + knowledge.db）');
