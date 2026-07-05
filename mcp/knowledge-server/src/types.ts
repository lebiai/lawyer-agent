export interface KnowledgeItem {
  id: string;
  type: 'law' | 'case' | 'template' | 'term' | 'personal_note';
  title: string;
  content: string;
  tags: string[];
  reference?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  metadata: string;
}

export interface SearchResult {
  item: KnowledgeItem;
  score: number;
  matchedTags: string[];
}

export interface ConversationLog {
  id: string;
  date: string;
  caseType: string;
  question: string;
  topics: string[];
  laws: string[];
  stored: boolean;
}

export interface UserProfile {
  totalConversations: number;
  totalKnowledge: number;
  caseTypeDistribution: Record<string, number>;
  topLaws: Array<{ law: string; count: number }>;
  topTopics: Array<{ topic: string; count: number }>;
  lastWeekCount: number;
  knowledgeGrowth: number;
}

export const TOOLS = {
  SEARCH: 'search_knowledge',
  EXTRACT: 'extract_knowledge',
  STORE: 'store_knowledge',
  LIST: 'list_knowledge',
  DELETE: 'delete_knowledge',
  LOG_CONVERSATION: 'log_conversation',
  GET_PROFILE: 'get_user_profile',
} as const;
