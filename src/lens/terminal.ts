import type { HudSnapshot, Tokens, Totals } from './types.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { wrapToWidth } from '../render/ansi.js';
import { formatTokens } from '../utils/format.js';

const RESET = '\x1b[0m';
const number = (n: number | null | undefined) => n == null ? '—' : formatTokens(n);
const percent = (p: number | null) => p === null ? '—' : `${p.toFixed(1)}%`;
const color = (hex: string) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
function totalsLine(name: string, t: Totals): string {
  const reading = (key: keyof Tokens) => number(t.missingTokens?.includes(key) ? null : t[key]);
  return `${name} · 输入总量 ${reading('input')} · 未缓存输入 ${number(t.uncachedInput)} · 输出 ${reading('output')} · 缓存读取 ${reading('cacheRead')} · 缓存写入 ${reading('cacheWrite')} · 命中率 ${percent(t.hitRate === null ? null : t.hitRate * 100)}`;
}

export function renderLensLines(snapshot: HudSnapshot, columns = 100): string[] {
  const c = snapshot.context;
  let remaining = 30;
  let bar = '';
  for (const segment of c.segments) {
    const blocks = Math.min(remaining, Math.max(0, Math.round((segment.percent ?? 0) * 30 / 100)));
    remaining -= blocks;
    bar += color(segment.color) + '█'.repeat(blocks);
  }
  bar += '\x1b[2m' + '░'.repeat(remaining) + RESET;
  const lines = [
    `Context Lens · ${sanitizeDisplayText(snapshot.session.client)} · ${sanitizeDisplayText(snapshot.session.modelName || snapshot.session.model) || '—'}`,
    snapshot.session.client === 'claude'
      ? `Context window ${number(c.usedTokens)} / ${number(c.modelTokens)} (${percent(c.windowPercent)}) · model`
      : `${c.view === 'model' ? '上下文窗口' : '上下文预算'} ${c.windowEstimated && c.usedTokens !== null ? '≈' : ''}${number(c.usedTokens)} / ${number(c.denominator)} (${c.windowEstimated && c.percent !== null ? '≈' : ''}${percent(c.percent)})`,
    bar,
    ...c.segments.map(s => `${color(s.color)}■${RESET} ${s.label}: ${s.accuracy === 'estimated' ? '≈' : ''}${number(s.tokens)} (${percent(s.percent)})`),
    totalsLine('Main', snapshot.totals.main),
    ...(snapshot.totals.agentCount ? [totalsLine(`Agents (${snapshot.totals.agentCount})`, snapshot.totals.agents), totalsLine('Total', snapshot.totals.all)] : []),
    `Cache (main): ${snapshot.cache.state}`,
    `Custom cost: ${snapshot.cost.amount === null ? 'unconfigured' : `${snapshot.cost.currency} ${snapshot.cost.amount.toFixed(6)} (${snapshot.cost.complete ? 'estimate' : 'partial estimate'})`}`,
    ...(snapshot.nativeCostUsd === null ? [] : [`Client cost: USD ${snapshot.nativeCostUsd.toFixed(4)}`]),
    `Budget: ${snapshot.session.client === 'claude' ? number(c.budget.tokens) + ' tokens · ' : ''}${sanitizeDisplayText(c.budget.source)}${c.budget.accuracy === 'estimated' ? ' (estimated)' : ''}`,
    ...snapshot.warnings.map(w => `! ${sanitizeDisplayText(w)}`),
  ];
  return lines.flatMap(line => wrapToWidth(line, columns));
}
