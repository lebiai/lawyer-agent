#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BaseStore } from './base-store.js';
import { PersonalStore } from './personal-store.js';
import { KnowledgeExtractor } from './extractor.js';
import { TOOLS, SearchInput, ExtractInput, KnowledgeItem } from './types.js';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const baseStore = new BaseStore(DATA_DIR);
const personalStore = new PersonalStore(DATA_DIR);
const extractor = new KnowledgeExtractor();

// --init 模式：导入 seed 后退出
if (process.argv.includes('--init')) {
  console.log('📚 正在导入基础法律知识...');
  baseStore.initFromSeed();
  console.log(`✅ Base 库: ${baseStore.count()} 条`);
  console.log(`✅ Personal 库: ${personalStore.count()} 条`);
  process.exit(0);
}

// 正常启动时也初始化
baseStore.initFromSeed();

const server = new Server(
  { name: 'lawyer-knowledge-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOLS.SEARCH,
      description: '搜索法律知识库，包含基础法条判例和个人积累',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          type: {
            type: 'string',
            enum: ['law', 'case', 'template', 'term', 'personal_note'],
            description: '筛选类型',
          },
          limit: { type: 'number', description: '返回条数上限' },
        },
        required: ['query'],
      },
    },
    {
      name: TOOLS.EXTRACT,
      description: '从会话文本中提取知识点并存入个人知识库',
      inputSchema: {
        type: 'object',
        properties: {
          conversationText: { type: 'string', description: '要分析的会话文本' },
        },
        required: ['conversationText'],
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
      const { query, type, limit } = args as unknown as SearchInput;
      const baseResults = baseStore.search(query, type, limit ?? 5);
      const personalResults = personalStore.search(query, type, limit ?? 5);
      const combined = [...baseResults, ...personalResults]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit ?? 10);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            results: combined,
            totalBase: baseStore.count(),
            totalPersonal: personalStore.count(),
          }, null, 2),
        }],
      };
    }

    case TOOLS.EXTRACT: {
      const { conversationText } = args as unknown as ExtractInput;
      const result = await extractor.extract(conversationText);
      let saved = 0;
      for (const item of result.items) {
        const existing = personalStore.search(item.title, item.type, 1);
        if (existing.length > 0 && existing[0].score > 5) {
          personalStore.incrementUsage(existing[0].item.id);
          continue;
        }
        personalStore.add({
          ...item,
          id: `personal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date().toISOString(),
          usageCount: 1,
        } as KnowledgeItem);
        saved++;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ saved, summary: result.summary, total: personalStore.count() }),
        }],
      };
    }

    case TOOLS.LIST: {
      const { type } = (args ?? {}) as { type?: string };
      const items = personalStore.getAll(type as any);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            total: items.length,
            items: items.map(i => ({
              id: i.id, title: i.title, type: i.type,
              tags: i.tags, usageCount: i.usageCount, createdAt: i.createdAt,
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
console.error('📚 律师知识库 MCP Server 已启动');
