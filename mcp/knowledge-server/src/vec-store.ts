import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KnowledgeItem, SearchResult } from './types.js';
import { getEmbeddingService } from './embed.js';

/** 默认向量维度（bge-base-zh-v1.5 实际输出 768 维） */
const DEFAULT_DIMENSION = 768;

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs = 5 * 60 * 1000;

  constructor(itemCount: number = 50) {
    this.maxSize = Math.min(Math.max(Math.floor(itemCount * 0.3), 50), 1000);
  }

  resize(itemCount: number) {
    const newSize = Math.min(Math.max(Math.floor(itemCount * 0.3), 50), 1000);
    if (newSize !== this.maxSize) {
      this.maxSize = newSize;
      if (this.cache.size > this.maxSize) {
        const keys = [...this.cache.keys()];
        const toDelete = this.cache.size - this.maxSize;
        for (let i = 0; i < toDelete && i < keys.length; i++) {
          this.cache.delete(keys[i]);
        }
      }
    }
  }

  private key(query: string, type?: string, source?: string): string {
    return `${query}|${type || ""}|${source || ""}`;
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

/** 获取实际向量维度，优先取模型维度，回退到默认值 */
function getActualDimension(): number {
  try {
    const svc = getEmbeddingService();
    // 如果模型已初始化，用实际维度；否则用默认
    return svc.dimension || DEFAULT_DIMENSION;
  } catch {
    return DEFAULT_DIMENSION;
  }
}

function padVector(vec: number[], dim?: number): Float32Array {
  const targetDim = dim || getActualDimension();
  const padded = new Float32Array(targetDim);
  padded.set(vec.slice(0, targetDim));
  return padded;
}

export class VecStore {
  private db: Database.Database;
  private queryCache: QueryCache;
  cacheItemCount: number = 0;

  constructor(dbPath: string) {
    this.queryCache = new QueryCache(this.cacheItemCount);
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=NORMAL');
    this.initTables();
  }

  private getStoredDimension(): number {
    // v2+ DB: 从 _schema_meta 读取维度
    const metaExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_meta'"
    ).get();
    if (metaExists) {
      const row = this.db.prepare(
        "SELECT value FROM _schema_meta WHERE key = 'vector_dimension'"
      ).get();
      if (row) return parseInt((row as any).value, 10);
    } else {
      // 旧版 DB: vec0 表存在但无 _schema_meta → 原硬编码 1024 维
      const vecExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vectors'"
      ).get();
      if (vecExists) return 1024;
    }
    return 0;
  }

  private initTables() {
    const modelDim = getActualDimension();
    const storedDim = this.getStoredDimension();

    // 如果表已存在且维度不匹配，迁移
    if (storedDim > 0 && storedDim !== modelDim) {
      console.error(`[迁移] 向量维度 ${storedDim} → ${modelDim}，重建向量表...`);
      // 暂存已有知识条目 id，迁移后重新索引
      const existingIds = (this.db.prepare('SELECT id FROM knowledge').all() || []).map((r: any) => r.id);
      this.db.exec('DROP TABLE IF EXISTS knowledge_vectors');
      this.db.exec("DROP TABLE IF EXISTS _schema_meta");
      // 标记需要重新索引（server.ts 预热模型后调用 reindexVectors）
      this._needsReindex = existingIds;
    }

    // 如果表存在且维度匹配，只初始化常规表
    const vecTableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vectors'"
    ).get();

    if (!vecTableExists) {
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
          embedding FLOAT[${modelDim}]
        );

        CREATE TABLE IF NOT EXISTS tag_index (
          tag    TEXT NOT NULL,
          kb_id  TEXT NOT NULL,
          PRIMARY KEY (tag, kb_id)
        );

        CREATE TABLE IF NOT EXISTS _schema_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('vector_dimension', '${modelDim}');
        INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', '2');
      `);
    } else {
      // 仅确保常规表和元数据表存在
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

        CREATE TABLE IF NOT EXISTS tag_index (
          tag    TEXT NOT NULL,
          kb_id  TEXT NOT NULL,
          PRIMARY KEY (tag, kb_id)
        );

        CREATE TABLE IF NOT EXISTS _schema_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // 确保维度元数据写入
      this.db.prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('vector_dimension', ?)"
      ).run(String(modelDim));
    }
  }

  // 迁移后需要重新索引的条目 id
  private _needsReindex: string[] | null = null;

  /** 获取需要重新索引的条目数量 */
  get needsReindexCount(): number {
    return this._needsReindex ? this._needsReindex.length : 0;
  }

  /** 迁移后重新生成向量索引（需嵌入模型已预热） */
  async reindexVectors(): Promise<number> {
    if (!this._needsReindex || this._needsReindex.length === 0) return 0;
    const ids = this._needsReindex;
    this._needsReindex = null;

    const items = [];
    for (const id of ids) {
      const row = this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as any;
      if (row) items.push(rowToItem(row));
    }

    if (items.length === 0) return 0;
    console.error(`[迁移] 重新索引 ${items.length} 条知识...`);
    await this.addMany(items);
    console.error(`[迁移] ✅ 重新索引完成`);
    return items.length;
  }

    close() { this.db.close(); }
  resizeCache() {
    const total = this.count();
    if (total !== this.cacheItemCount) {
      this.cacheItemCount = total;
      this.queryCache.resize(total);
    }
  }

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

  async add(item: KnowledgeItem, precomputedEmbedding?: number[]): Promise<void> {
    let embedding: number[];
    if (precomputedEmbedding) {
      embedding = precomputedEmbedding;
    } else {
      const svc = getEmbeddingService();
      embedding = await svc.embed(item.title + ' ' + item.content);
    }
    this.addWithEmbedding(item, embedding);
    this.queryCache.invalidate();
    this.resizeCache();
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
    this.resizeCache();
  }

  // ===== 搜索 =====

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, type, source, limit = 10 } = options;

    const cached = this.queryCache.get(query, type, source);
    if (cached) return cached;

    const svc = getEmbeddingService();
    const queryVec = await svc.embed(query);

    const conditions: string[] = ['1=1'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  async findSimilar(options: FindSimilarOptions, precomputedEmbedding?: number[]): Promise<SearchResult | null> {
    const { title, content, type, threshold = 0.9 } = options;
    let queryVec: number[];
    if (precomputedEmbedding) {
      queryVec = precomputedEmbedding;
    } else {
      const svc = getEmbeddingService();
      queryVec = await svc.embed(title + ' ' + content);
    }

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
    this.resizeCache();
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
