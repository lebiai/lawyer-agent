import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { ConversationLog, UserProfile } from './types.js';

export class UserProfileStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        date       TEXT NOT NULL,
        case_type  TEXT NOT NULL,
        question   TEXT NOT NULL,
        topics     TEXT NOT NULL DEFAULT '[]',
        laws       TEXT NOT NULL DEFAULT '[]',
        stored     INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(date);
      CREATE INDEX IF NOT EXISTS idx_conversations_case ON conversations(case_type);
    `);
    // 自动清理超过6个月的对话日志
    this.db.exec("DELETE FROM conversations WHERE date < datetime('now', '-6 months')");
  }

  async log(entry: ConversationLog): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, date, case_type, question, topics, laws, stored)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.date, entry.caseType, entry.question,
           JSON.stringify(entry.topics), JSON.stringify(entry.laws), entry.stored ? 1 : 0);
  }

  getProfile(): UserProfile {
    const totalConversations = (this.db.prepare('SELECT COUNT(*) as c FROM conversations').get() as any).c;
    const totalKnowledge = (this.db.prepare("SELECT COUNT(*) as c FROM knowledge WHERE source = 'extract'").get() as any).c || 0;

    // 案由分布
    const caseRows = this.db.prepare(`
      SELECT case_type, COUNT(*) as c FROM conversations GROUP BY case_type ORDER BY c DESC
    `).all() as any[];
    const caseTypeDistribution: Record<string, number> = {};
    for (const r of caseRows) caseTypeDistribution[r.case_type] = r.c;

    // 从 conversations.laws 中提取高频法条
    const lawCounts: Record<string, number> = {};

    // 1. conversations 中的法条引用
    const allLaws = this.db.prepare('SELECT laws FROM conversations').all() as any[];
    for (const r of allLaws) {
      try {
        const parsed = JSON.parse(r.laws);
        if (Array.isArray(parsed)) {
          for (const law of parsed) {
            lawCounts[law] = (lawCounts[law] || 0) + 1;
          }
        }
      } catch { /* skip invalid JSON */ }
    }

    // 2. 个人知识库中的法条类知识（按 usage_count 加权）
    const knowledgeLaws = this.db.prepare(`
      SELECT title, usage_count FROM knowledge WHERE type = 'law' ORDER BY usage_count DESC
    `).all() as any[];
    for (const r of knowledgeLaws) {
      lawCounts[r.title] = (lawCounts[r.title] || 0) + (r.usage_count || 1);
    }

    const topLaws = Object.entries(lawCounts)
      .map(([law, count]) => ({ law, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 关注话题
    const allTopics: Record<string, number> = {};
    const topicRows = this.db.prepare('SELECT topics FROM conversations').all() as any[];
    for (const r of topicRows) {
      try {
        const ts = JSON.parse(r.topics);
        for (const t of ts) allTopics[t] = (allTopics[t] || 0) + 1;
      } catch {}
    }
    const topTopics = Object.entries(allTopics)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 近一周活跃度
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const lastWeekCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM conversations WHERE date >= ?'
    ).get(weekAgo) as any).c;

    return {
      totalConversations,
      totalKnowledge,
      caseTypeDistribution,
      topLaws,
      topTopics,
      lastWeekCount,
      knowledgeGrowth: totalKnowledge,
    };
  }

  close() { this.db.close(); }
}
