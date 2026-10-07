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
  messageBreakdown?: MessageSegment[];
}
export type MessageKind = 'user' | 'assistant' | 'thinking' | 'toolCall' | 'toolResult' | 'file' | 'plan' | 'summary' | 'other';
export interface MessageSegment extends Measurement { id: MessageKind }
export interface Tokens {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  cacheWrite5m: number; cacheWrite1h: number; reasoning: number;
}
export interface RequestUsage extends Tokens {
  timestampKnown?: boolean;
  id: string; model: string; at: string; complete: boolean;
  serviceTier?: string;
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
  pricing?: { model: string; source: string; checkedAt?: string; tier: string }[];
}
export interface CacheState {
  state: 'warm' | 'cold' | 'expired' | 'unknown'; source: string;
  accuracy: Accuracy; expiresAt: string | null;
}
export interface SessionInfo {
  id: string; client: Client; cwd: string; model: string; updatedAt: string;
  parentId?: string; title?: string;
}
export type ActivityKind = 'commands' | 'skills' | 'mcp';
export type ActivityStatus = 'succeeded' | 'failed' | 'running' | 'unknown';
export interface ActivityCall {
  id: string; kind: ActivityKind; name: string; detail: string;
  action: 'run' | 'invoke' | 'read'; status: ActivityStatus;
  at: string | null; durationMs: number | null; exitCode: number | null;
  scope?: 'main' | 'agent';
}
export interface ActivityCounts {
  total: number; succeeded: number; failed: number; running: number; unknown: number;
  durationMs: number | null; durationComplete: boolean;
}
export interface ActivitySummary extends ActivityCounts {
  main: number; agents: number; invoked: number; reads: number;
  groups: (ActivityCounts & { name: string; detail: string; action: ActivityCall['action'] })[];
  recent: ActivityCall[];
}
export interface SessionActivity {
  complete: boolean;
  commands: ActivitySummary; skills: ActivitySummary; mcp: ActivitySummary;
}
export interface SessionTiming {
  startedAt: string | null; startAccuracy: 'reported' | 'observed' | 'unknown';
  lastActivityAt: string | null; elapsedMs: number | null; activeMs: number | null;
  currentTurnMs: number | null; currentTurnStartedAt: string | null;
  completedTurns: number | null; status: 'running' | 'waiting' | 'interrupted' | 'unknown';
  activeAccuracy: 'reported' | 'derived' | 'unknown'; complete: boolean;
}
export interface HudSnapshot {
  session: Omit<SessionInfo, 'client'> & { client: string }; context: Context;
  totals: { main: Totals; agents: Totals; all: Totals; agentCount: number };
  cache: CacheState; cost: CostEstimate; nativeCostUsd: number | null;
  activity?: SessionActivity;
  timing?: SessionTiming;
  insights?: SessionInsights;
  warnings: string[]; capturedAt: string;
}

export interface CompactionEvent {
  id: string; at: string | null; trigger: string | null;
  beforeTokens: number | null; afterTokens: number | null; releasedTokens: number | null;
  cumulativeDroppedTokens: number | null; durationMs: number | null; retainedMessages: number | null;
}
export interface HookEvent {
  id: string; at: string | null; name: string; event: string; toolUseId: string | null;
  status: 'succeeded' | 'failed' | 'unknown'; exitCode: number | null; durationMs: number | null;
}
export interface HookStop {
  id: string; at: string | null; hookCount: number | null; errorCount: number | null;
  preventedContinuation: boolean | null;
}
export interface FileOperation {
  id: string; at: string | null; endedAt: string | null; tool: string; path: string;
  action: 'read' | 'write' | 'edit'; status: ActivityStatus;
  addedLines: number | null; removedLines: number | null;
}
export interface SessionTask {
  id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'unknown';
  at: string | null; source: string;
}
export interface AgentRun {
  id: string; agentId: string | null; type: string; description: string | null;
  model: string | null; background: boolean; status: ActivityStatus;
  at: string | null; endedAt: string | null;
}
export interface ClaudeDetails {
  complete: boolean; compactions: CompactionEvent[]; hooks: HookEvent[]; hookStops: HookStop[];
  files: FileOperation[]; tasks: SessionTask[]; agents: AgentRun[];
  metadata: Partial<Record<'version' | 'gitBranch' | 'permissionMode', { value: string; at: string | null }>>;
}
export interface SessionInsights {
  scope: 'main'; complete: boolean;
  compactions?: { count: number; latest: CompactionEvent };
  hooks?: { total: number; failed: number; durationMs: number | null; durationComplete: boolean; blockedStops: number };
  files?: { operations: number; uniquePaths: number; reads: number; writes: number; edits: number; failed: number };
  tasks?: { total: number; completed: number; inProgress: number; pending: number; failed: number };
  agents?: { total: number; running: number; completed: number; failed: number };
  metadata?: ClaudeDetails['metadata'];
}
