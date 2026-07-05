import { env, pipeline } from '@xenova/transformers';

export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class LocalEmbeddingService implements EmbeddingService {
  private extractor: any = null;
  private modelName: string;
  private initPromise: Promise<void> | null = null;
  private _dimension = 768;

  get dimension(): number { return this._dimension; }

  constructor(modelName?: string) {
    this.modelName = modelName || process.env.EMBEDDING_MODEL || 'Xenova/bge-base-zh-v1.5';
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
    await this.init();
    const input = this.modelName.includes('bge') ? `为这个句子生成向量：${text}` : text;
    const result = await this.extractor(input, { pooling: 'mean', normalize: true });
    return Array.from(result.data) as number[];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.init();
    const batchSize = 10;
    const results: number[][] = [];
    const dim = this._dimension;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const inputs = batch.map(t =>
        this.modelName.includes('bge') ? `为这个句子生成向量：${t}` : t
      );
      const output = await this.extractor(inputs, { pooling: 'mean', normalize: true });
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
