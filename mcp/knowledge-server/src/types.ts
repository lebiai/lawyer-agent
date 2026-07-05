export interface KnowledgeItem {
  id: string;
  type: 'law' | 'case' | 'template' | 'term' | 'personal_note';
  title: string;
  content: string;
  tags: string[];
  reference?: string;
  source?: string;
  createdAt: string;
  usageCount: number;
}

export interface SearchResult {
  item: KnowledgeItem;
  score: number;
  matchedTags: string[];
}

export interface ExtractInput {
  conversationText: string;
}

export interface SearchInput {
  query: string;
  type?: KnowledgeItem['type'];
  limit?: number;
}

export const TOOLS = {
  SEARCH: 'search_knowledge',
  EXTRACT: 'extract_knowledge',
  LIST: 'list_knowledge',
  DELETE: 'delete_knowledge',
} as const;
