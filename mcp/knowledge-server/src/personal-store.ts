import { KnowledgeItem } from './types.js';
import { VecStore } from './vec-store.js';
import { join } from 'path';

export class PersonalStore {
  private store: VecStore;
  constructor(dbPath: string) {
    // Personal shares the same DB, distinguished by source field
    this.store = new VecStore(join(dbPath, 'knowledge.db'));
  }
  get vecStore() { return this.store; }

  async add(item: KnowledgeItem) { await this.store.add(item); }
  async search(query: string, type?: string, limit = 10) { return this.store.search(query, type, limit); }
  async findSimilar(title: string, content: string, type: string, threshold = 0.9) {
    return this.store.findSimilar(title, content, type, threshold);
  }
  getAll(type?: string) { return this.store.getAll(type); }
  delete(id: string) { return this.store.delete(id); }
  incrementUsage(id: string) { this.store.incrementUsage(id); }
  count(source?: string) { return this.store.count(undefined, source || 'extract'); }
}
