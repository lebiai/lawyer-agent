import { VecStore } from './vec-store.js';

/**
 * BASE 知识库
 * 从 seed.db 读取只读的公共知识
 */
export class BaseStore {
  private seedDb: VecStore;
  private seedPath: string;

  constructor(seedPath: string) {
    this.seedPath = seedPath;
    // 立即打开 seed.db，确保启动时进行维度迁移检查
    this.seedDb = new VecStore(this.seedPath);
  }

  async search(query: string, type?: string, limit = 10) {
    return this.seedDb.search({ query, type, source: 'seed', limit });
  }

  count() {
    return this.seedDb.count(undefined, 'seed');
  }

  /** 需要重新索引的条目数（维度迁移） */
  get needsReindexCount(): number {
    return this.seedDb.needsReindexCount;
  }

  /** 执行向量重新索引 */
  async reindexVectors(): Promise<number> {
    return this.seedDb.reindexVectors();
  }
}
