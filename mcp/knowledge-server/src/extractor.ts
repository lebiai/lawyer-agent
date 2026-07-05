import { KnowledgeItem } from './types.js';

export interface ExtractResult {
  items: Array<Pick<KnowledgeItem, 'title' | 'content' | 'type' | 'tags' | 'reference'>>;
  summary: string;
}

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

    // 案由提取
    const caseTypes = [
      '民间借贷', '买卖合同', '劳动争议', '离婚', '继承',
      '交通事故', '房屋租赁', '建设工程', '知识产权', '股权纠纷'
    ];
    for (const ct of caseTypes) {
      if (conversationText.includes(ct) && !result.items.some(i => i.title.includes(ct))) {
        result.items.push({
          title: ct,
          content: `涉及${ct}纠纷`,
          type: 'personal_note',
          tags: ['案由', ct],
        });
        break;
      }
    }

    result.summary = `提取了 ${result.items.length} 条知识点`;
    return result;
  }
}
