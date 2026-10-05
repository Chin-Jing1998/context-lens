export type Client = 'claude' | 'codex';
export type Accuracy = 'reported' | 'estimated' | 'configured' | 'derived' | 'unknown';
export type Category = 'mcpTools' | 'systemTools' | 'skills' | 'systemPrompt' | 'memoryFiles'
  | 'mcpInstructions' | 'messages' | 'unclassified' | 'buffer' | 'free';
export interface Measurement { tokens: number | null; source: string; accuracy: Accuracy; at?: string }
export interface Segment extends Measurement { id: Category; label: string; color: string; percent: number | null }
export interface Budget {
  tokens: number | null;
  source: string;
  accuracy: Accuracy;
  scope: 'total' | 'body_after_prefix';
  disabled?: boolean;
  prefixTokens?: number;
}
export interface Context {
  usedTokens: number | null; modelTokens: number | null; budget: Budget;
  denominator: number | null; percent: number | null; view: 'budget' | 'model';
  segments: Segment[]; warnings: string[]; updatedAt: string | null;
}
export interface Tokens {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  cacheWrite5m: number; cacheWrite1h: number; reasoning: number;
}
export interface RequestUsage extends Tokens {
  id: string; model: string; at: string; complete: boolean;
}
export interface Totals extends Tokens {
  requests: number | null; cacheReadRequests: number | null;
  hitRate: number | null; complete: boolean;
}
export interface Rate {
  input?: number; output?: number; cacheRead?: number;
  cacheWrite?: number; cacheWrite5m?: number; cacheWrite1h?: number;
}
export interface LensConfig { currency: string; prices: Record<string, Rate> }
export interface CostEstimate {
  amount: number | null; currency: string; complete: boolean; unpricedModels: string[];
}
export interface CacheState {
  state: 'warm' | 'cold' | 'expired' | 'unknown'; source: string;
  accuracy: Accuracy; expiresAt: string | null;
}
export interface SessionInfo {
  id: string; client: Client; cwd: string; model: string; updatedAt: string;
  parentId?: string;
}
export interface HudSnapshot {
  session: SessionInfo; context: Context;
  totals: { main: Totals; agents: Totals; all: Totals; agentCount: number };
  cache: CacheState; cost: CostEstimate; nativeCostUsd: number | null;
  warnings: string[]; capturedAt: string;
}
