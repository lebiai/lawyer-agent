import { KnowledgeItem } from './types.js';
import { VecStore } from './vec-store.js';

export class PersonalStore {
  private store: VecStore;

  constructor(store: VecStore) {
    this.store = store;
  }

  get vecStore() { return this.store; }

  async add(item: KnowledgeItem) { await this.store.add(item); }
  async search(query: string, type?: string, limit = 10) {
    return this.store.search(query, type, 'extract', limit);
  }
  async findSimilar(title: string, content: string, type: string, threshold = 0.9) {
    return this.store.findSimilar(title, content, type, threshold);
  }
  getAll(type?: string) { return this.store.getAll(type); }
  delete(id: string) { return this.store.delete(id); }
  incrementUsage(id: string) { this.store.incrementUsage(id); }
  count() { return this.store.count(undefined, 'extract'); }
}
