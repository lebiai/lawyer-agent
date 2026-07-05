import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline } from '@xenova/transformers';
import { readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(__dirname, '../seed');
const OUTPUT = join(__dirname, '../data/seed.db');
const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/bge-base-zh-v1.5';

async function main() {
  console.log('Compiling seed data...');
  const allItems = [];

  for (const file of readdirSync(SEED_DIR).filter(f => f.endsWith('.json'))) {
    const items = JSON.parse(readFileSync(join(SEED_DIR, file), 'utf-8'));
    for (const item of items) {
      item.source = 'seed';
      item.updatedAt = item.updatedAt || item.createdAt;
    }
    allItems.push(...items);
    console.log(`  ${file}: ${items.length} items`);
  }

  const tmplDir = join(SEED_DIR, 'templates');
  if (existsSync(tmplDir)) {
    for (const f of readdirSync(tmplDir).filter(f => f.endsWith('.md'))) {
      const name = f.replace('.md', '');
      allItems.push({
        id: `template-${name}`, type: 'template',
        title: name.replace(/-/g, ' '),
        content: readFileSync(join(tmplDir, f), 'utf-8'),
        tags: ['template', name], source: 'seed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0, metadata: '{}',
      });
    }
  }

  console.log(`\nTotal: ${allItems.length}, generating embeddings...`);
  const extractor = await pipeline('feature-extraction', MODEL, { quantized: true });
  const dim = extractor.model.config.hidden_size || 768;
  console.log(`Model dim: ${dim}`);

  const embeddings = [];
  for (let i = 0; i < allItems.length; i++) {
    const text = allItems[i].title + ' ' + allItems[i].content;
    const input = MODEL.includes('bge') ? `\u4e3a\u8fd9\u4e2a\u53e5\u5b50\u751f\u6210\u5411\u91cf\uff1a${text}` : text;
    const result = await extractor(input, { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(result.data));
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${allItems.length}`);
  }

  if (existsSync(OUTPUT)) unlinkSync(OUTPUT);
  const db = new Database(OUTPUT);
  sqliteVec.load(db);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`
    CREATE TABLE knowledge (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      reference TEXT, source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      usage_count INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}'
    );
    CREATE VIRTUAL TABLE knowledge_vectors USING vec0(
      id TEXT PRIMARY KEY, embedding FLOAT[1024]
    );
  `);

  const insItem = db.prepare(`INSERT OR REPLACE INTO knowledge
    (id,type,title,content,tags,reference,source,created_at,updated_at,usage_count,metadata)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const insVec = db.prepare('INSERT OR REPLACE INTO knowledge_vectors(id,embedding) VALUES(?,?)');

  const tx = db.transaction(() => {
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      insItem.run(item.id,item.type,item.title,item.content,
        JSON.stringify(item.tags),item.reference||null,
        item.source,item.createdAt,item.updatedAt,
        item.usageCount,item.metadata||'{}');
      const p = new Float32Array(1024);
      p.set(embeddings[i].slice(0, 1024));
      insVec.run(item.id, p);
    }
  });
  tx();
  db.close();
  console.log(`\nDone: ${OUTPUT} (${allItems.length} items)`);
}

main().catch(console.error);
