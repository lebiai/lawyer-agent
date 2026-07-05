import { env, pipeline } from '@xenova/transformers';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class LocalEmbeddingService implements EmbeddingService {
  private extractor: any = null;
  private modelName: string;
  private initPromise: Promise<void> | null = null;

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.EMBEDDING_MODEL || 'Xenova/bge-base-zh-v1.5';
    // 使用默认缓存路径，不覆盖 XDG_CACHE_HOME
    env.localModelPath = env.localModelPath || (process.env.HOME + '/.cache/huggingface');
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
        console.error('[embed] 模型加载完成');
      } catch (e) {
        this.initPromise = null;
        console.error(`[embed] 模型加载失败: ${e}`);
        throw new Error(`嵌入模型加载失败: ${e}`);
      }
    })();

    return this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    const input = this.modelName.includes('bge') ? `为这个句子生成向量：${text}` : text;
    const result = await this.extractor(input, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(result.data) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();
    const batchSize = 10;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const inputs = batch.map(t =>
        this.modelName.includes('bge') ? `为这个句子生成向量：${t}` : t
      );
      // transformers.js 支持原生批处理
      const output = await this.extractor(inputs, {
        pooling: 'mean',
        normalize: true,
      });
      // output.data 是展平的 Float32Array，每行 768 个
      const dim = 768;
      for (let j = 0; j < inputs.length; j++) {
        results.push(Array.from(output.data.slice(j * dim, (j + 1) * dim)) as number[]);
      }
    }

    return results;
  }
}

let instance: LocalEmbeddingService | null = null;

export function getEmbeddingService(): LocalEmbeddingService {
  if (!instance) {
    instance = new LocalEmbeddingService();
  }
  return instance;
}
