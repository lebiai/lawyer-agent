import { KnowledgeItem } from './types.js';
import { VecStore } from './vec-store.js';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class BaseStore {
  private store: VecStore;
  private _initialized = false;

  constructor(store: VecStore) {
    this.store = store;
  }

  get vecStore() { return this.store; }

  async initFromSeed() {
    if (this._initialized) return;
    const allItems: KnowledgeItem[] = [];
    const seedDir = join(__dirname, '../seed');

    for (const file of ['laws.json', 'cases.json', 'terms.json']) {
      const fp = join(seedDir, file);
      if (existsSync(fp)) {
        const seedItems = JSON.parse(readFileSync(fp, 'utf-8')) as KnowledgeItem[];
        for (const item of seedItems) {
          item.source = item.source || 'seed';
          item.updatedAt = item.updatedAt || item.createdAt;
        }
        allItems.push(...seedItems);
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
          source: 'seed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          usageCount: 0,
          metadata: '{}',
        });
      }
    }

    if (allItems.length > 0) {
      await this.store.addMany(allItems);
    }
    this._initialized = true;
  }

  async search(query: string, type?: string, limit = 10) {
    return this.store.search({ query, type, source: 'seed', limit });
  }

  count() { return this.store.count(undefined, 'seed'); }
}
