import { displayLabel } from '../utils/sanitize.js';
import { percentageNumber, tokenNumber } from './context.js';
import { record } from './settings.js';
const FIVE_HOURS = 300;
const SEVEN_DAYS = 10080;
function isoTime(ms) {
    return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? new Date(ms).toISOString() : undefined;
}
function epochSeconds(value) {
    return typeof value === 'number' ? isoTime(value * 1000) : undefined;
}
export function codexQuota(value) {
    const data = record(value);
    if (!Object.hasOwn(data, 'primary') && !Object.hasOwn(data, 'secondary'))
        return undefined;
    const id = displayLabel(data.limit_id, 80) || 'codex';
    const name = displayLabel(data.limit_name, 100) || (id === 'codex' ? 'Codex' : id);
    const limits = [];
    for (const key of ['primary', 'secondary']) {
        const window = record(data[key]);
        const used = percentageNumber(window.used_percent);
        if (used === null)
            continue;
        const windowMinutes = tokenNumber(window.window_minutes) || undefined;
        limits.push({ id: `${id}:${key}`, name: windowMinutes ? name : `${name} · ${key === 'primary' ? '主额度' : '次额度'}`,
            windowMinutes, remainingPercent: 100 - used, resetAt: epochSeconds(window.resets_at) });
    }
    return { id, limits };
}
export function claudeQuota(value) {
    const data = record(value);
    const limits = [];
    for (const [id, windowMinutes] of [['five_hour', FIVE_HOURS], ['seven_day', SEVEN_DAYS]]) {
        const window = record(data[id]);
        const used = percentageNumber(window.used_percentage);
        if (used !== null)
            limits.push({ id, name: 'Claude Code', windowMinutes, remainingPercent: 100 - used, resetAt: epochSeconds(window.resets_at) });
    }
    return limits;
}
const agyGroups = new Map([['gemini', 'Gemini'], ['gemini-flash', 'Gemini Flash'], ['gemini-pro', 'Gemini Pro'], ['3p', 'Claude / GPT']]);
export function agyQuota(value, now) {
    const limits = [];
    for (const [bucket, raw] of Object.entries(record(value)).slice(0, 32)) {
        const id = displayLabel(bucket, 100), data = record(raw);
        if (!id || data.disabled === true)
            continue;
        const [, group, window] = /^(.*)-(5h|weekly)$/.exec(id) ?? [];
        const windowMinutes = window === '5h' ? FIVE_HOURS : window === 'weekly' ? SEVEN_DAYS : undefined;
        const name = agyGroups.get(group) ?? (group || id);
        const fraction = data.remaining_fraction, amount = data.remaining_amount;
        const delay = tokenNumber(data.reset_in_seconds);
        const resetAt = (typeof data.reset_time === 'string' ? isoTime(Date.parse(data.reset_time)) : undefined)
            ?? (delay !== null ? isoTime(now + delay * 1000) : undefined);
        if (typeof fraction === 'number' && fraction >= 0 && fraction <= 1) {
            limits.push({ id, name, windowMinutes, remainingPercent: fraction * 100, resetAt });
        }
        else if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
            limits.push({ id, name, windowMinutes, remainingAmount: amount, resetAt });
        }
    }
    return limits.sort((a, b) => a.name.localeCompare(b.name) || (a.windowMinutes ?? 0) - (b.windowMinutes ?? 0));
}
export function currentQuota(limits, now) {
    if (!Array.isArray(limits))
        return undefined;
    const current = limits.filter(limit => limit && typeof limit.id === 'string' && typeof limit.name === 'string'
        && (limit.resetAt === undefined || typeof limit.resetAt === 'string' && Date.parse(limit.resetAt) > now)
        && ('remainingPercent' in limit ? percentageNumber(limit.remainingPercent) !== null
            : Number.isFinite(limit.remainingAmount) && limit.remainingAmount >= 0));
    return current.length ? current : undefined;
}
//# sourceMappingURL=quota.js.map