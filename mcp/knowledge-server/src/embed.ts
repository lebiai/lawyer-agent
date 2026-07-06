import { env, pipeline } from '@xenova/transformers';
import { createHash } from 'crypto';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ===== 嵌入向量缓存 =====
// 相同文本的嵌入结果直接命中，避免重复推理
class EmbeddingCache {
  private cache = new Map<string, { vector: number[]; timestamp: number }>();
  private maxSize = 500;
  private ttlMs = 30 * 60 * 1000; // 30 分钟

  private key(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  get(text: string): number[] | null {
    const entry = this.cache.get(this.key(text));
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(this.key(text));
      return null;
    }
    return entry.vector;
  }

  set(text: string, vector: number[]) {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(this.key(text), { vector, timestamp: Date.now() });
  }

  invalidate() { this.cache.clear(); }

  get size() { return this.cache.size; }
}

// ===== 嵌入服务 =====

class LocalEmbeddingService implements EmbeddingService {
  private extractor: any = null;
  private modelName: string;
  private initPromise: Promise<void> | null = null;
  private _dimension = 768;
  private cache = new EmbeddingCache();

  get dimension(): number { return this._dimension; }
  get cacheSize(): number { return this.cache.size; }

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.EMBEDDING_MODEL || 'Xenova/bge-base-zh-v1.5';
    env.localModelPath = env.localModelPath || (
      process.platform === 'win32'
        ? (process.env.USERPROFILE + '/.cache/huggingface')
        : (process.env.HOME + '/.cache/huggingface')
    );
    env.remoteHost = process.env.HF_ENDPOINT || process.env.HF_MIRROR || 'https://huggingface.co/';
    if (!env.remoteHost.endsWith('/')) env.remoteHost += '/';
  }

  async init(): Promise<void> {
    if (this.extractor) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        console.error(`[embed] 加载模型: ${this.modelName}`);
        this.extractor = await pipeline('feature-extraction', this.modelName, {
          quantized: true,
        });
        this._dimension = this.extractor.model.config.hidden_size || 768;
        console.error(`[embed] 模型加载完成 (维度: ${this._dimension})`);
      } catch (e) {
        this.initPromise = null;
        console.error(`[embed] 模型加载失败: ${e}`);
        throw new Error(`嵌入模型加载失败: ${e}`);
      }
    })();

    return this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    // 缓存命中直接返回
    const cached = this.cache.get(text);
    if (cached) return cached;

    await this.init();
    const input = this.modelName.includes('bge') ? `为这个句子生成向量：${text}` : text;
    const result = await this.extractor(input, { pooling: 'mean', normalize: true });
    const vector = Array.from(result.data) as number[];

    // 写入缓存
    this.cache.set(text, vector);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 逐条查缓存，未命中的批量推理
    const results: number[][] = [];
    const uncached: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }

    if (uncached.length === 0) return results;

    await this.init();
    const batchSize = 10;
    const dim = this._dimension;

    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      const inputs = batch.map(t =>
        this.modelName.includes('bge') ? `为这个句子生成向量：${t.text}` : t.text
      );
      const output = await this.extractor(inputs, { pooling: 'mean', normalize: true });
      for (let j = 0; j < inputs.length; j++) {
        const vec = Array.from(output.data.slice(j * dim, (j + 1) * dim)) as number[];
        results[batch[j].index] = vec;
        this.cache.set(batch[j].text, vec);
      }
    }
    return results;
  }

  /** 清空缓存（知识库变更时调用） */
  invalidateCache() { this.cache.invalidate(); }
}

let instance: LocalEmbeddingService | null = null;

export function getEmbeddingService(): LocalEmbeddingService {
  if (!instance) {
    instance = new LocalEmbeddingService();
  }
  return instance;
}
