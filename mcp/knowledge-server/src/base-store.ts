import { VecStore } from './vec-store.js';

/**
 * BASE 知识库
 * 从 seed.db 读取只读的公共知识
 */
export class BaseStore {
  private seedDb: VecStore | null = null;
  private seedPath: string;

  constructor(seedPath: string) {
    this.seedPath = seedPath;
  }

  /** 打开 seed.db（懒加载） */
  private ensureOpen() {
    if (!this.seedDb) {
      this.seedDb = new VecStore(this.seedPath);
    }
  }

  async search(query: string, type?: string, limit = 10) {
    this.ensureOpen();
    return this.seedDb!.search({ query, type, source: 'seed', limit });
  }

  count() {
    this.ensureOpen();
    return this.seedDb!.count(undefined, 'seed');
  }
}
