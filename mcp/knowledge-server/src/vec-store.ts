import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KnowledgeItem, SearchResult } from './types.js';
import { getEmbeddingService } from './embed.js';

const MAX_DIMENSION = 1024;

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;
  private ttlMs = 5 * 60 * 1000;

  private key(query: string, type?: string, source?: string): string {
    return `${query}|${type || ''}|${source || ''}`;
  }

  get(query: string, type?: string, source?: string): SearchResult[] | null {
    const entry = this.cache.get(this.key(query, type, source));
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(this.key(query, type, source));
      return null;
    }
    return entry.results;
  }

  set(query: string, type: string | undefined, source: string | undefined, results: SearchResult[]) {
    const k = this.key(query, type, source);
    if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(k, { results, timestamp: Date.now() });
  }

  invalidate() { this.cache.clear(); }
}

export interface SearchOptions {
  query: string;
  type?: string;
  source?: string;
  limit?: number;
  /** 索引策略预留: flat | hnsw | ivf */
  indexType?: 'flat';
}

export interface FindSimilarOptions {
  title: string;
  content: string;
  type: string;
  threshold?: number;
}

function rowToItem(row: any): KnowledgeItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    reference: row.reference || undefined,
    source: row.source || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: row.usage_count,
    metadata: row.metadata || '{}',
  };
}

function padVector(vec: number[]): Float32Array {
  const padded = new Float32Array(MAX_DIMENSION);
  padded.set(vec.slice(0, MAX_DIMENSION));
  return padded;
}

export class VecStore {
  private db: Database.Database;
  private queryCache = new QueryCache();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT NOT NULL DEFAULT '[]',
        reference   TEXT,
        source      TEXT DEFAULT 'manual',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        usage_count INTEGER DEFAULT 0,
        metadata    TEXT DEFAULT '{}'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vectors USING vec0(
        id        TEXT PRIMARY KEY,
        embedding FLOAT[${MAX_DIMENSION}]
      );

      CREATE TABLE IF NOT EXISTS tag_index (
        tag    TEXT NOT NULL,
        kb_id  TEXT NOT NULL,
        PRIMARY KEY (tag, kb_id)
      );
    `);
  }

  close() { this.db.close(); }

  // ===== 写入 =====

  private addWithEmbedding(item: KnowledgeItem, embedding: number[]) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge
        (id, type, title, content, tags, reference, source, created_at, updated_at, usage_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      item.id, item.type, item.title, item.content,
      JSON.stringify(item.tags), item.reference || null,
      item.source || 'manual', item.createdAt, item.updatedAt || item.createdAt,
      item.usageCount, item.metadata || '{}'
    );

    this.db.prepare('INSERT OR REPLACE INTO knowledge_vectors (id, embedding) VALUES (?, ?)')
      .run(item.id, padVector(embedding));

    const tagInsert = this.db.prepare('INSERT OR IGNORE INTO tag_index (tag, kb_id) VALUES (?, ?)');
    for (const tag of item.tags) tagInsert.run(tag, item.id);
  }

  async add(item: KnowledgeItem): Promise<void> {
    const svc = getEmbeddingService();
    const embedding = await svc.embed(item.title + ' ' + item.content);
    this.addWithEmbedding(item, embedding);
    this.queryCache.invalidate();
  }

  async addMany(items: KnowledgeItem[]): Promise<void> {
    const svc = getEmbeddingService();
    const texts = items.map(i => i.title + ' ' + i.content);
    const embeddings = await svc.embedBatch(texts);

    const tx = this.db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        this.addWithEmbedding(items[i], embeddings[i]);
      }
    });
    tx();
    this.queryCache.invalidate();
  }

  // ===== 搜索 =====

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, type, source, limit = 10 } = options;

    // 查询缓存
    const cached = this.queryCache.get(query, type, source);
    if (cached) return cached;

    // 生成查询向量
    const svc = getEmbeddingService();
    const queryVec = await svc.embed(query);

    // 构建 SQL
    const conditions: string[] = ['1=1'];
    const params: any[] = [padVector(queryVec)];
    if (type) { conditions.push('k.type = ?'); params.push(type); }
    if (source) { conditions.push('k.source = ?'); params.push(source); }

    const sql = `
      SELECT k.*, v.distance
      FROM knowledge_vectors v
      JOIN knowledge k ON v.id = k.id
      WHERE v.embedding MATCH ?
        AND ${conditions.join(' AND ')}
      AND k = ?
      ORDER BY v.distance
    `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    const results = rows.map(row => ({
      item: rowToItem(row),
      score: 1 - row.distance,
      matchedTags: [],
    }));

    this.queryCache.set(query, type, source, results);
    return results;
  }

  // ===== 去重检查 =====

  async findSimilar(options: FindSimilarOptions): Promise<SearchResult | null> {
    const { title, content, type, threshold = 0.9 } = options;
    const svc = getEmbeddingService();
    const queryVec = await svc.embed(title + ' ' + content);

    const row = this.db.prepare(`
      SELECT k.*, v.distance
      FROM knowledge_vectors v
      JOIN knowledge k ON v.id = k.id
      WHERE v.embedding MATCH ?
        AND k.type = ?
      AND k = 1
      ORDER BY v.distance
    `).get(padVector(queryVec), type) as any;

    if (row && row.distance < (1 - threshold)) {
      return { item: rowToItem(row), score: 1 - row.distance, matchedTags: [] };
    }
    return null;
  }

  // ===== 管理 =====

  getAll(type?: string): KnowledgeItem[] {
    if (type) {
      return (this.db.prepare('SELECT * FROM knowledge WHERE type = ? ORDER BY created_at DESC').all(type) as any[]).map(rowToItem);
    }
    return (this.db.prepare('SELECT * FROM knowledge ORDER BY created_at DESC').all() as any[]).map(rowToItem);
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM knowledge_vectors WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM tag_index WHERE kb_id = ?').run(id);
    this.queryCache.invalidate();
    return true;
  }

  incrementUsage(id: string) {
    this.db.prepare('UPDATE knowledge SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  count(type?: string, source?: string): number {
    const conditions: string[] = [];
    const params: any[] = [];
    if (type) { conditions.push('type = ?'); params.push(type); }
    if (source) { conditions.push('source = ?'); params.push(source); }
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const row = this.db.prepare('SELECT COUNT(*) as c FROM knowledge' + where).get(...params) as any;
    return row.c;
  }

  countByType(): Record<string, number> {
    const rows = this.db.prepare('SELECT type, COUNT(*) as c FROM knowledge GROUP BY type').all() as any[];
    const result: Record<string, number> = {};
    for (const row of rows) result[row.type] = row.c;
    return result;
  }
}
