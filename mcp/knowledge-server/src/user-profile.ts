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

    const caseRows = this.db.prepare(`
      SELECT case_type, COUNT(*) as c FROM conversations GROUP BY case_type ORDER BY c DESC
    `).all() as any[];
    const caseTypeDistribution: Record<string, number> = {};
    for (const r of caseRows) caseTypeDistribution[r.case_type] = r.c;

    // Top laws from knowledge store usage_count
    const lawRows = this.db.prepare(`
      SELECT title, usage_count FROM knowledge WHERE type = 'law' ORDER BY usage_count DESC LIMIT 5
    `).all() as any[];
    const topLaws = lawRows.map(r => ({ law: r.title, count: r.usage_count }));

    // Top topics from conversations
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
