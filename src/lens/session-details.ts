import path from 'node:path';
import type { ParsedSession } from './reader.js';
import type { SessionFile } from './sessions.js';
import { sessionKey } from './sessions.js';
import { estimateCost, sumRequests, TOKEN_KEYS } from './usage.js';
import { readOfficialPrices } from './pricing.js';
import { sessionTiming } from './timing.js';
import type { LensConfig, RequestUsage } from './types.js';

export type DetailSection = 'requests' | 'activity' | 'compactions' | 'hooks' | 'hookStops' | 'files' | 'tasks' | 'agents';
export interface DetailQuery {
  section?: string; scope?: string; page?: number; pageSize?: number; status?: string; kind?: string; sort?: string;
}
export interface DetailSource { file: SessionFile; parsed: ParsedSession }
type DetailRow = Record<string, any> & { id: string; sessionId: string; scope: 'main' | 'agent'; at: string | null };

export function validateDetailQuery(query: DetailQuery): { section: DetailSection; scope: string; page: number; pageSize: number; sort: string } {
  const section = query.section ?? 'requests', scope = query.scope ?? 'all', page = query.page ?? 1, pageSize = query.pageSize ?? 20, sort = query.sort ?? 'newest';
  if (!['requests', 'activity', 'compactions', 'hooks', 'hookStops', 'files', 'tasks', 'agents'].includes(section)
    || !['main', 'agents', 'all'].includes(scope) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !['newest', 'oldest', 'duration', 'cost'].includes(sort)
    || sort === 'cost' && section !== 'requests'
    || sort === 'duration' && !['activity', 'hooks', 'compactions'].includes(section)
    || query.kind !== undefined && (section !== 'activity' || !['commands', 'skills', 'mcp'].includes(query.kind))
    || query.status !== undefined && (!['activity', 'hooks', 'files', 'tasks', 'agents'].includes(section)
      || !['succeeded', 'failed', 'running', 'unknown', 'pending', 'in_progress', 'completed'].includes(query.status))) throw new Error('Invalid detail query');
  return { section: section as DetailSection, scope, page, pageSize, sort };
}

/** Read-only, paged projections over the same parsed logs and deduplicated accounting ledger. */
export function buildSessionDetails(key: string, sources: DetailSource[], prices: LensConfig, query: DetailQuery = {}, unavailable: string[] = []) {
  const { section, scope, page: requestedPage, pageSize, sort } = validateDetailQuery(query);
  const root = sources[0], rows: DetailRow[] = [], owners = new Set<string>();
  const catalog = readOfficialPrices();
  const ownRequests = new Map<string, RequestUsage[]>();
  // Parent records have priority, exactly as in the existing cumulative snapshot.
  for (const source of sources) {
    const own = source.parsed.requests.filter(row => !owners.has(row.id));
    own.forEach(row => owners.add(row.id)); ownRequests.set(source.file.id, own);
  }
  const requestCoverage = (source: DetailSource): boolean => {
    const own = ownRequests.get(source.file.id)!, sum = sumRequests(own, source.parsed.complete);
    return sum.complete && !(own.length === source.parsed.requests.length && source.parsed.cumulative
      && TOKEN_KEYS.some(key => source.parsed.cumulative![key] > sum[key]));
  };
  const selected = sources.filter(source => scope === 'all' || (scope === 'main') === (source === root));
  let complete = unavailable.length === 0;
  const support = section === 'requests' || section === 'activity' || section === 'agents' && sources.length > 1
    || sources.some(source => !!source.parsed.details);
  const linkedAgents = new Set<string>();
  for (const source of selected) {
    const { file, parsed } = source;
    const scopeName = source === root ? 'main' as const : 'agent' as const;
    const add = (item: Record<string, any> & { id: string }, at: string | null = item.at ?? null) => rows.push({ ...item, sessionId: file.id, scope: scopeName, at });
    if (section === 'requests') {
      complete &&= requestCoverage(source);
      for (const row of ownRequests.get(file.id)!) add({ ...row, cost: estimateCost([row], prices, row.complete, catalog) },
        row.timestampKnown === false || !Number.isFinite(Date.parse(row.at)) ? null : row.at);
    } else if (section === 'activity') {
      complete &&= parsed.activity?.complete === true;
      for (const call of parsed.activity?.calls ?? []) add(call);
    } else {
      complete &&= parsed.details?.complete === true;
      if (section !== 'agents') for (const item of parsed.details?.[section] ?? []) add(item);
      else for (const agent of parsed.details?.agents ?? []) {
        const child = agent.agentId ? sources.find(candidate => candidate.file.parentId === file.id
          && path.basename(candidate.file.file, '.jsonl') === `agent-${agent.agentId}`) : undefined;
        if (child) linkedAgents.add(child.file.id);
        const requests = child ? ownRequests.get(child.file.id)! : null;
        add({ ...agent, childSessionId: child?.file.id ?? null, childSessionKey: child ? sessionKey(child.file) : null,
          totals: requests ? sumRequests(requests, requestCoverage(child!)) : null,
          cost: requests ? estimateCost(requests, prices, requestCoverage(child!), catalog) : null,
          timing: child?.parsed.timing ? sessionTiming(child.parsed.timing) : null, accountingScope: 'own' });
      }
    }
  }
  if (section === 'agents') for (const child of sources.slice(1)) {
    const parent = sources.find(source => source.file.id === child.file.parentId);
    if (!parent || !selected.includes(parent) || linkedAgents.has(child.file.id)) continue;
    const requests = ownRequests.get(child.file.id)!;
    rows.push({ id: `session:${child.file.id}`, sessionId: parent.file.id, scope: parent === root ? 'main' : 'agent',
      at: null, status: 'unknown', description: null, model: child.parsed.info.model, childSessionId: child.file.id,
      childSessionKey: sessionKey(child.file), totals: sumRequests(requests, requestCoverage(child)),
      cost: estimateCost(requests, prices, requestCoverage(child), catalog), accountingScope: 'own',
      timing: child.parsed.timing ? sessionTiming(child.parsed.timing) : null });
  }
  const filtered = rows.filter(row => (!query.status || row.status === query.status) && (!query.kind || row.kind === query.kind));
  const value = (row: DetailRow): number | null => sort === 'cost' ? row.cost?.amount ?? null : sort === 'duration' ? row.durationMs ?? null
    : row.at && Number.isFinite(Date.parse(row.at)) ? Date.parse(row.at) : null;
  filtered.sort((a, b) => {
    const x = value(a), y = value(b);
    return x === null && y !== null ? 1 : y === null && x !== null ? -1
      : x !== null && y !== null && x !== y ? (sort === 'oldest' ? x - y : y - x) : a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), page = Math.min(requestedPage, pages);
  return { session: key, section, scope, history: section === 'requests' ? 'ledger' : 'available-log',
    supported: support, complete: support && complete, total: filtered.length, page, pages, pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize), unavailable, capturedAt: new Date().toISOString() };
}
