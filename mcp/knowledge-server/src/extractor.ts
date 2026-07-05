import { KnowledgeItem } from './types.js';

export interface ExtractResult {
  items: Array<Pick<KnowledgeItem, 'title' | 'content' | 'type' | 'tags' | 'reference'>>;
  summary: string;
}

/**
 * 知识提取器（兜底方案）
 * 主要提取由 AGENTS.md 指令引导 Codex 调用 store_knowledge 完成
 * 正则提取作为补充，抓取对话中的法条引用和案号
 */
export class KnowledgeExtractor {
  async extract(conversationText: string): Promise<ExtractResult> {
    const result: ExtractResult = { items: [], summary: '' };

    // 法条引用提取
    const lawPattern = /(《[^》]+》第[^条]*条)/g;
    const lawMatches = conversationText.match(lawPattern);
    if (lawMatches) {
      for (const match of [...new Set(lawMatches)]) {
        result.items.push({
          title: match.trim(),
          content: match.trim(),
          type: 'law',
          tags: ['法条引用', match.trim()],
          reference: match.trim(),
        });
      }
    }

    // 判例案号提取
    const casePattern = /(\([0-9]{4}\)[^号]*号)/g;
    const caseMatches = conversationText.match(casePattern);
    if (caseMatches) {
      for (const match of [...new Set(caseMatches)]) {
        result.items.push({
          title: match.trim(),
          content: match.trim(),
          type: 'case',
          tags: ['类案', match.trim()],
          reference: match.trim(),
        });
      }
    }

    result.summary = `提取了 ${result.items.length} 条知识点`;
    return result;
  }
}
