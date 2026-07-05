import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { KnowledgeItem, SearchResult } from './types.js';

export class LocalStore {
  private items: KnowledgeItem[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load() {
    if (existsSync(this.filePath)) {
      try {
        this.items = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      } catch {
        this.items = [];
      }
    } else {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.items = [];
      this.save();
    }
  }

  private save() {
    writeFileSync(this.filePath, JSON.stringify(this.items, null, 2), 'utf-8');
  }

  add(item: KnowledgeItem) { this.items.push(item); this.save(); }
  addMany(items: KnowledgeItem[]) { this.items.push(...items); this.save(); }

  search(query: string, type?: string, limit = 10): SearchResult[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const scored = this.items
      .filter((item) => !type || item.type === type)
      .map((item) => {
        let score = 0;
        const matchedTags: string[] = [];
        const titleLower = item.title.toLowerCase();
        const contentLower = item.content.toLowerCase();

        for (const tag of item.tags) {
          if (tokens.some((t) => tag.toLowerCase().includes(t))) {
            score += 3;
            matchedTags.push(tag);
          }
        }
        for (const token of tokens) {
          if (titleLower.includes(token)) score += 2;
          if (contentLower.includes(token)) score += 1;
        }
        return { item, score, matchedTags };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored;
  }

  getAll(type?: string): KnowledgeItem[] {
    return type ? this.items.filter((i) => i.type === type) : [...this.items];
  }

  delete(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.save();
    return true;
  }

  incrementUsage(id: string) {
    const item = this.items.find((i) => i.id === id);
    if (item) { item.usageCount++; this.save(); }
  }

  count(): number { return this.items.length; }
}
