import { env, pipeline } from '@xenova/transformers';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class LocalEmbeddingService implements EmbeddingService {
  private extractor: any = null;
  private modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.EMBEDDING_MODEL || 'Xenova/bge-base-zh-v1.5';
    // 禁用自动下载进度条，避免干扰 stdio
    env.localModelPath = process.env.HOME + '/.cache/huggingface';
  }

  async init() {
    if (!this.extractor) {
      console.error(`[embed] 加载模型: ${this.modelName}`);
      this.extractor = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
      console.error('[embed] 模型加载完成');
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    // bge 系列需要加 instruction prefix
    const input = this.modelName.includes('bge') ? `为这个句子生成向量：${text}` : text;
    const result = await this.extractor(input, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(result.data) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();
    const results: number[][] = [];
    // 分批处理，避免内存爆炸
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...batchResults);
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
