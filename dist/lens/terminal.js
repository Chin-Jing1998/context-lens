import { sanitizeDisplayText } from '../utils/sanitize.js';
import { wrapToWidth } from '../render/ansi.js';
import { formatTokens } from '../utils/format.js';
const RESET = '\x1b[0m';
const number = (n) => n === null ? '?' : formatTokens(n);
const percent = (p) => p === null ? '?' : `${p.toFixed(1)}%`;
const color = (hex) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
function totalsLine(name, t) {
    return `${name}${t.complete ? '' : ' (incomplete)'}: in ${number(t.input)} · out ${number(t.output)} · cache read ${number(t.cacheRead)} / ${t.cacheReadRequests ?? '?'} requests · hit ${percent(t.hitRate === null ? null : t.hitRate * 100)}`;
}
export function renderLensLines(snapshot, columns = 100) {
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
        `Context Lens · ${sanitizeDisplayText(snapshot.session.client)} · ${sanitizeDisplayText(snapshot.session.model)}`,
        `Context window ${number(c.usedTokens)} / ${number(c.denominator)} (${percent(c.percent)}) · ${c.view}`,
        bar,
        ...c.segments.map(s => `${color(s.color)}■${RESET} ${s.label}: ${s.accuracy === 'estimated' ? '≈' : ''}${number(s.tokens)} (${percent(s.percent)})`),
        totalsLine('Main', snapshot.totals.main),
        ...(snapshot.totals.agentCount ? [totalsLine(`Agents (${snapshot.totals.agentCount})`, snapshot.totals.agents), totalsLine('Total', snapshot.totals.all)] : []),
        `Cache (main): ${snapshot.cache.state} · writes ${number(snapshot.totals.all.cacheWrite)}`,
        `Custom cost: ${snapshot.cost.amount === null ? 'unconfigured' : `${snapshot.cost.currency} ${snapshot.cost.amount.toFixed(6)} (${snapshot.cost.complete ? 'estimate' : 'partial estimate'})`}`,
        ...(snapshot.nativeCostUsd === null ? [] : [`Client cost: USD ${snapshot.nativeCostUsd.toFixed(4)}`]),
        `Budget: ${sanitizeDisplayText(c.budget.source)}${c.budget.accuracy === 'estimated' ? ' (estimated)' : ''}`,
        ...snapshot.warnings.map(w => `! ${sanitizeDisplayText(w)}`),
    ];
    return lines.flatMap(line => wrapToWidth(line, columns));
}
//# sourceMappingURL=terminal.js.map