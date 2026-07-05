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
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// 共享同一个 VecStore 实例
const store = new VecStore(join(DATA_DIR, 'knowledge.db'));
const baseStore = new BaseStore(store);
const personalStore = new PersonalStore(store);

// --init 模式：导入 seed 后退出
if (process.argv.includes('--init')) {
  console.log('📚 正在导入基础法律知识并生成向量嵌入...');
  await baseStore.initFromSeed();
  console.log(`✅ Base 库: ${baseStore.count()} 条`);
  console.log(`✅ Personal 库: ${personalStore.count()} 条`);
  process.exit(0);
}

// 正常启动
await baseStore.initFromSeed();

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
          type: {
            type: 'string',
            enum: ['law', 'case', 'template', 'term', 'personal_note'],
            description: '筛选类型（可选）',
          },
          limit: { type: 'number', description: '返回条数上限', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: TOOLS.STORE,
      description: '将结构化知识存入个人知识库，自动生成向量嵌入。用于从对话中保存提取的律师经验',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '知识标题' },
          content: { type: 'string', description: '知识内容' },
          type: {
            type: 'string',
            enum: ['law', 'case', 'template', 'term', 'personal_note'],
            description: '知识类型',
            default: 'personal_note',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表',
          },
          reference: { type: 'string', description: '法条号/案号（如有）' },
          metadata: {
            type: 'object',
            description: '扩展元数据（案由、法院等）',
          },
        },
        required: ['title', 'content'],
      },
    },
    {
      name: TOOLS.LIST,
      description: '查看个人知识库摘要',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['law', 'case', 'template', 'term', 'personal_note'],
          },
        },
      },
    },
    {
      name: TOOLS.DELETE,
      description: '删除个人知识库中的条目',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '知识条目 ID' },
        },
        required: ['id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case TOOLS.SEARCH: {
      const { query, type, limit } = args as any;
      const startTime = Date.now();
      // base 和 personal 各自按 source 过滤搜索
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

      // 去重检查
      const existing = await personalStore.findSimilar(
        title, content, type || 'personal_note', 0.9
      );
      if (existing) {
        personalStore.incrementUsage(existing.item.id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              saved: false,
              matched: existing.item.id,
              title: existing.item.title,
              usageCount: existing.item.usageCount + 1,
              message: '已有相似条目，已增加引用计数',
            }),
          }],
        };
      }

      await personalStore.add({
        id,
        type: type || 'personal_note',
        title,
        content,
        tags: tags || [],
        reference: reference || undefined,
        source: 'extract',
        createdAt: now,
        updatedAt: now,
        usageCount: 1,
        metadata: JSON.stringify(metadata || {}),
      } as any);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            saved: true, id, title,
            message: '已存入个人知识库',
          }),
        }],
      };
    }

    case TOOLS.LIST: {
      const { type } = (args ?? {}) as { type?: string };
      const items = personalStore.getAll(type as any);
      const byType = personalStore.vecStore.countByType();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: items.length,
            byType,
            items: items.slice(0, 50).map(i => ({
              id: i.id, title: i.title, type: i.type,
              tags: typeof i.tags === 'string' ? JSON.parse(i.tags) : (i.tags || []),
              usageCount: i.usageCount,
              createdAt: i.createdAt,
            })),
          }, null, 2),
        }],
      };
    }

    case TOOLS.DELETE: {
      const { id } = args as { id: string };
      const deleted = personalStore.delete(id);
      return { content: [{ type: 'text', text: JSON.stringify({ deleted }) }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('📚 律师知识库 MCP Server v2 已启动（sqlite-vec 向量引擎，WAL 模式）');
