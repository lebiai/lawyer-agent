import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { KnowledgeItem, SearchResult } from './types.js';
import { getEmbeddingService } from './embed.js';

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

export class VecStore {
  private db: Database.Database;

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
        embedding FLOAT[768]
      );

      CREATE TABLE IF NOT EXISTS tag_index (
        tag    TEXT NOT NULL,
        kb_id  TEXT NOT NULL,
        PRIMARY KEY (tag, kb_id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  // ===== 写入 =====

  private async addWithEmbedding(
    item: KnowledgeItem,
    embedding: number[]
  ): Promise<void> {
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
      .run(item.id, new Float32Array(embedding));

    const tagInsert = this.db.prepare('INSERT OR IGNORE INTO tag_index (tag, kb_id) VALUES (?, ?)');
    for (const tag of item.tags) {
      tagInsert.run(tag, item.id);
    }
  }

  async add(item: KnowledgeItem): Promise<void> {
    const embedService = getEmbeddingService();
    const embedding = await embedService.embed(item.title + ' ' + item.content);
    await this.addWithEmbedding(item, embedding);
  }

  async addMany(items: KnowledgeItem[]): Promise<void> {
    const embedService = getEmbeddingService();
    const texts = items.map(i => i.title + ' ' + i.content);
    const embeddings = await embedService.embedBatch(texts);

    const tx = this.db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        this.addWithEmbedding(items[i], embeddings[i]);
      }
    });
    tx();
  }

  // ===== 搜索 =====

  async search(
    query: string,
    type?: string,
    source?: string,
    limit = 10
  ): Promise<SearchResult[]> {
    const embedService = getEmbeddingService();
    const queryVec = await embedService.embed(query);

    const conditions: string[] = ['1=1'];
    const params: any[] = [new Float32Array(queryVec)];

    if (type) { conditions.push('k.type = ?'); params.push(type); }
    if (source) { conditions.push('k.source = ?'); params.push(source); }

    const sql = `
      SELECT k.*, v.distance
      FROM knowledge_vectors v
      JOIN knowledge k ON v.id = k.id
      WHERE v.embedding MATCH ?
        AND ${conditions.join(' AND ')}
      ORDER BY v.distance
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      item: rowToItem(row),
      score: 1 - row.distance,
      matchedTags: [],
    }));
  }

  // ===== 去重检查 =====

  async findSimilar(
    title: string, content: string, type: string,
    threshold = 0.9
  ): Promise<SearchResult | null> {
    const embedService = getEmbeddingService();
    const queryVec = await embedService.embed(title + ' ' + content);

    const row = this.db.prepare(`
      SELECT k.*, v.distance
      FROM knowledge_vectors v
      JOIN knowledge k ON v.id = k.id
      WHERE v.embedding MATCH ?
        AND k.type = ?
      ORDER BY v.distance
      LIMIT 1
    `).get(new Float32Array(queryVec), type) as any;

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
    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const row = this.db.prepare('SELECT COUNT(*) as c FROM knowledge' + whereClause).get(...params) as any;
    return row.c;
  }

  countByType(): Record<string, number> {
    const rows = this.db.prepare('SELECT type, COUNT(*) as c FROM knowledge GROUP BY type').all() as any[];
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = row.c;
    }
    return result;
  }
}
