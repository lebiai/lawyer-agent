import { KnowledgeItem } from './types.js';
import { LocalStore } from './store.js';
import { join } from 'path';

export class PersonalStore {
  private store: LocalStore;
  constructor(personalPath: string) {
    this.store = new LocalStore(join(personalPath, 'personal-knowledge.json'));
  }

  add(item: KnowledgeItem) { this.store.add(item); }
  search(query: string, type?: string, limit = 10) { return this.store.search(query, type, limit); }
  getAll(type?: string) { return this.store.getAll(type); }
  delete(id: string) { return this.store.delete(id); }
  count() { return this.store.count(); }
  incrementUsage(id: string) { this.store.incrementUsage(id); }
}
