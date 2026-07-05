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

  // seed.db 直接替换，BaseStore 下次搜索自动读新数据
  console.error('[update] ✅ seed.db 已更新');
  return true;
}

// ===== 知识库初始化 =====

// knowledge.db 只存个人数据，首次启动时 VecStore 自动创建空库

// VecStore 实例（knowledge.db 专用，存个人数据）
const store = new VecStore(DB_PATH);

// BaseStore 直接读 seed.db（只读）
const baseStore = new BaseStore(SEED_PATH);
const personalStore = new PersonalStore(store);

// ===== 启动时预热嵌入模型（避免首次查询等待下载） =====
await autoUpdateSeed();
console.error('[启动] 预热嵌入模型...');
try {
  const svc = getEmbeddingService();
  await svc.init();
  console.error('[启动] 嵌入模型预热完成');
} catch (e) {
  console.error('[启动] 嵌入模型预热失败: ' + e);
}


// ===== MCP Server =====

const server = new Server(
  { name: 'lawyer-knowledge-server', version: '2.0.0' },
  { capabilities: { tools: {} } },
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
          text: JSON.stringify({ saved: true, id, title, message: '已存入个人知识库' }),
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
