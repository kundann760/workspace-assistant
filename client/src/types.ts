export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  document_count: number;
}

export interface DocumentItem {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  chunk_count: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  created_at: string;
  shared_with: { workspaceId: string; workspaceName: string }[];
}

export interface SharedInDocument {
  id: string;
  filename: string;
  chunk_count: number;
  status: string;
  created_at: string;
  source_workspace_id: string;
  source_workspace_name: string;
}

export interface Citation {
  id: number;
  documentId: string;
  filename: string;
  section: string | null;
  chunkId: string;
  snippet: string;
  shared: boolean;
}

export interface RetrievalSource {
  id: number;
  origin: 'initial' | 'search_documents';
  chunkId: string;
  documentId: string;
  workspaceId: string;
  filename: string;
  section: string | null;
  chunkIndex: number;
  shared: boolean;
  similarity: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  rrfScore: number;
  preview: string;
}

export interface RetrievalDebug {
  workspaceId: string;
  query: string;
  hit: boolean;
  minSimilarity: number;
  droppedCount: number;
  latencyMs: number;
  sources: RetrievalSource[];
}

export interface ToolCallSummary {
  id?: string;
  name: string;
  args: unknown;
  status: 'success' | 'error' | 'rejected';
  error?: string | null;
  latencyMs: number;
}

export interface MessageMetrics {
  model?: string;
  latencyMs?: number;
  firstTokenMs?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  llmCalls?: number;
  retrievalHit?: boolean;
  retrievedCount?: number;
  topSimilarity?: number | null;
  toolCalls?: number;
  failed?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'complete' | 'error';
  reply_to: string | null;
  citations: Citation[];
  retrieval: RetrievalDebug | null;
  metrics: MessageMetrics | null;
  error: string | null;
  created_at: string;
  tool_calls: ToolCallSummary[];
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: 'open' | 'done';
  created_at: string;
}

export interface ToolCallLog {
  id: string;
  tool_name: string;
  arguments: unknown;
  result: unknown;
  status: 'success' | 'error' | 'rejected';
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  question: string | null;
}

export interface MetricsResponse {
  summary: {
    requests: number;
    failed_requests: number;
    avg_latency_ms: number | null;
    avg_first_token_ms: number | null;
    prompt_tokens: number;
    completion_tokens: number;
    retrieval_hits: number;
    retrieval_misses: number;
  };
  tools: { tool_name: string; success: number; error: number; rejected: number; avg_latency_ms: number | null }[];
  recent: { id: string; status: string; metrics: MessageMetrics; created_at: string; question: string | null }[];
}
