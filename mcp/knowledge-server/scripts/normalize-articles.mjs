#!/usr/bin/env node
/**
 * 知识库法条引用规范化工具
 * 将中文数字法条引用转为阿拉伯数字，如：
 *   "第一百四十七条" → "第147条"
 *   "第二款" → "第2款"
 *   "第五百零六条" → "第506条"
 *
 * 用法: node scripts/normalize-articles.mjs [--seed] [--personal]
 *   --seed     规范化公共库 (seed.db)
 *   --personal 规范化个人库 (knowledge.db)
 *   不传参数 → 同时处理两个库
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const CN_MAP = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3,
  '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};
const SCALES = { '十': 10, '百': 100, '千': 1000, '万': 10000 };

function cnToArabic(s) {
  let result = 0, current = 0;
  for (const ch of s) {
    if (ch in CN_MAP) { current = CN_MAP[ch]; }
    else if (ch in SCALES) {
      result += (current || 1) * SCALES[ch];
      current = 0;
    }
  }
  return result + current;
}

function normalizeArticle(match) {
  const prefix = match[0][0];     // 第
  const suffix = match[0].at(-1); // 条/款/项/目
  const numStr = match[0].slice(1, -1);
  return `${prefix}${cnToArabic(numStr)}${suffix}`;
}

async function normalizeDb(dbPath, label) {
  if (!existsSync(dbPath)) {
    console.log(`⏭️  ${label}: 文件不存在 (${dbPath})`);
    return;
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');

  const pattern = /第[一二三四五六七八九十百千万零〇]+[条款项目]/g;
  const rows = db.prepare('SELECT id, title, content FROM knowledge').all();

  let changes = 0;
  const update = db.prepare('UPDATE knowledge SET title = ?, content = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of rows) {
      const newTitle = r.title.replace(pattern, normalizeArticle);
      const newContent = (r.content || '').replace(pattern, normalizeArticle);
      if (newTitle !== r.title || newContent !== r.content) {
        update.run(newTitle, newContent, r.id);
        changes++;
        if (r.title !== newTitle) console.log(`  📝 ${r.title} → ${newTitle}`);
      }
    }
  });
  tx();
  db.close();

  if (changes > 0) {
    console.log(`✅ ${label}: 规范化 ${changes} 条`);
  } else {
    console.log(`✅ ${label}: 无需修改`);
  }
}

// ===== Main =====
const args = process.argv.slice(2);
const doSeed = args.length === 0 || args.includes('--seed');
const doPersonal = args.length === 0 || args.includes('--personal');

(async () => {
  console.log('🔍 法条引用规范化工具\n');
  if (doSeed) await normalizeDb(join(DATA_DIR, 'seed.db'), '公共库 (seed.db)');
  if (doPersonal) await normalizeDb(join(DATA_DIR, 'knowledge.db'), '个人库 (knowledge.db)');
  console.log('\n完成');
})();
