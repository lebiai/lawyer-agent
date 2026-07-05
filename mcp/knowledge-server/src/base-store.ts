import { KnowledgeItem } from './types.js';
import { LocalStore } from './store.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class BaseStore {
  private store: LocalStore;
  private _initialized = false;
  constructor(basePath: string) {
    this.store = new LocalStore(join(basePath, 'base-index.json'));
  }
  get initialized() { return this._initialized; }

  initFromSeed() {
    if (this._initialized) return;
    const allItems: KnowledgeItem[] = [];
    const seedDir = join(__dirname, '../seed');

    for (const file of ['laws.json', 'cases.json', 'terms.json']) {
      const fp = join(seedDir, file);
      if (existsSync(fp)) {
        allItems.push(...JSON.parse(readFileSync(fp, 'utf-8')) as KnowledgeItem[]);
      }
    }

    const tmplDir = join(seedDir, 'templates');
    if (existsSync(tmplDir)) {
      for (const f of readdirSync(tmplDir).filter(f => f.endsWith('.md'))) {
        const name = f.replace('.md', '');
        allItems.push({
          id: `template-${name}`,
          type: 'template',
          title: name.replace(/-/g, ' '),
          content: readFileSync(join(tmplDir, f), 'utf-8'),
          tags: ['模板', name],
          createdAt: new Date().toISOString(),
          usageCount: 0,
        });
      }
    }

    if (allItems.length > 0) this.store.addMany(allItems);
    this._initialized = true;
  }

  search(query: string, type?: string, limit = 10) { return this.store.search(query, type, limit); }
  count() { return this.store.count(); }
}
