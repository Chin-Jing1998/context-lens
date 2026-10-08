import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, lensHome, readPrices, record } from './settings.js';
import { discoverSessions } from './sessions.js';
import { readSession } from './reader.js';
import { mergeRequests, sumRequests, estimateCost } from './usage.js';
import { buildContext } from './context.js';
import { buildCostReport, costRange } from './cost-report.js';
import { defaultCostSources, readSqliteCosts, validateCostSession, walkCostFiles } from './cost-adapters.js';
import { currentDeepSeekLogs, readDeepSeekCosts } from './cost-deepseek.js';
const key = (s) => JSON.stringify([s.tool, s.id]);
const stamp = (file) => { const s = fs.statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; };
function defaultNative() {
    return [...discoverSessions(), ...discoverSessions({ claude: '/__context_lens_no_claude__',
            codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'archived_sessions') })];
}
export class CostHistory {
    sessions = new Map();
    stamps = new Map();
    pending;
    scannedAt = 0;
    initialized = false;
    failed = false;
    invalidLedger = false;
    home;
    sources;
    native;
    constructor(options = {}) {
        this.home = options.home ?? lensHome();
        this.sources = options.sources ?? defaultCostSources();
        this.native = options.native ?? defaultNative;
        for (const file of walkCostFiles(path.join(this.home, 'cost-history'), /\.json$/, 0)) {
            try {
                if (fs.statSync(file).size > 32 * 1024 * 1024)
                    throw new Error('Oversized ledger');
                const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (saved.version !== 1)
                    throw new Error('Unknown ledger');
                const session = validateCostSession(saved.session);
                this.sessions.set(key(session), session);
            }
            catch {
                this.failed = true;
                this.invalidLedger = true;
            }
        }
    }
    save(session, replaceSamples = false) {
        const id = key(session), previous = this.sessions.get(id);
        const excluded = new Set([...(previous?.excludedRequestIds ?? []), ...(session.excludedRequestIds ?? [])]);
        const next = { ...previous, ...session, title: session.title || previous?.title,
            requests: replaceSamples ? [...new Map([...(previous?.requests ?? []), ...session.requests].map(r => [r.id, r])).values()]
                : mergeRequests([...(previous?.requests ?? []), ...session.requests]) };
        if (excluded.size) {
            next.excludedRequestIds = [...excluded];
            next.requests = next.requests.filter(r => !excluded.has(r.id));
        }
        if (JSON.stringify(previous) === JSON.stringify(next))
            return;
        const file = path.join(this.home, 'cost-history', createHash('sha256').update(id).digest('hex') + '.json');
        atomicJson(file, { version: 1, session: next });
        this.sessions.set(id, next);
    }
    /** Imports are validated in full and committed as one durable batch before becoming visible. */
    import(value) {
        const raw = record(value);
        if (raw.version !== 1 || !Array.isArray(raw.sessions) || raw.sessions.length > 1000)
            throw new Error('Invalid accounting document');
        const sessions = raw.sessions.map(validateCostSession);
        const document = { version: 1, sessions };
        const digest = createHash('sha256').update(JSON.stringify(document)).digest('hex');
        atomicJson(path.join(this.home, 'cost-imports', digest + '.json'), document);
        for (const s of sessions)
            this.save(s);
        return sessions.reduce((n, s) => n + s.requests.length, 0);
    }
    async refresh(force = false) {
        if (this.pending)
            return this.pending;
        if (!force && this.initialized && Date.now() - this.scannedAt < 10000)
            return;
        this.pending = (async () => {
            let failed = false;
            const collect = async (id, version, load, replaceSamples = false) => {
                if (this.stamps.get(id) === version)
                    return;
                try {
                    for (const session of await load())
                        this.save(session, replaceSamples);
                    this.stamps.set(id, version);
                }
                catch {
                    failed = true;
                }
            };
            for (const file of this.native()) {
                await collect(file.file, `${file.size}:${file.mtimeMs}`, async () => {
                    const parsed = await readSession(file.file, file, { usageOnly: true });
                    return [{ tool: file.client, toolName: file.client === 'claude' ? 'Claude Code' : 'Codex', id: file.id, title: file.title,
                            parentId: file.parentId, requests: parsed.requests, complete: parsed.complete }];
                });
            }
            for (const source of this.sources) {
                if (!fs.existsSync(source.path))
                    continue;
                if (source.format === 'deepseek') {
                    for (const file of currentDeepSeekLogs(walkCostFiles(source.path, /\.jsonl(?:\.zstd)?$/))) {
                        await collect(file, stamp(file), async () => readDeepSeekCosts(file, source), true);
                    }
                }
                else if (source.format !== 'ledger') {
                    const version = [source.path, source.path + '-wal'].filter(f => fs.existsSync(f)).map(stamp).join('|');
                    await collect(source.path, version, () => readSqliteCosts(source));
                }
            }
            // Other harnesses can append the public accounting format without changing this application's tool list.
            for (const file of walkCostFiles(path.join(this.home, 'cost-imports'), /\.json$/, 0)) {
                await collect(file, stamp(file), async () => {
                    if (fs.statSync(file).size > 8 * 1024 * 1024)
                        throw new Error('Oversized import');
                    const raw = record(JSON.parse(fs.readFileSync(file, 'utf8')));
                    if (raw.version !== 1 || !Array.isArray(raw.sessions) || raw.sessions.length > 1000)
                        throw new Error('Invalid import');
                    return raw.sessions.map(validateCostSession);
                });
            }
            this.failed = failed || this.invalidLedger;
            this.scannedAt = Date.now();
            this.initialized = true;
        })().catch(() => { this.failed = true; this.initialized = true; this.scannedAt = Date.now(); }).finally(() => { this.pending = undefined; });
        return this.pending;
    }
    report(query) {
        costRange(query);
        void this.refresh();
        return buildCostReport([...this.sessions.values()], readPrices(), query, { loading: !this.initialized, failed: this.failed });
    }
    activeFiles() {
        return [...this.sessions.values()].filter(s => !['claude', 'codex'].includes(s.tool)).map(s => {
            const latest = [...s.requests].filter(r => r.at && r.timestampKnown !== false).sort((a, b) => b.at.localeCompare(a.at))[0];
            return { client: s.tool, id: s.id, title: s.title, parentId: s.parentId, cwd: '', model: latest?.model ?? 'unknown', updatedAt: latest?.at ?? '' };
        });
    }
    snapshot(identity, view) {
        const session = this.activeFiles().find(s => `${s.client}:${s.id}` === identity && !s.parentId);
        if (!session)
            return undefined;
        const main = this.sessions.get(key({ tool: session.client, id: session.id }));
        const children = new Set([main.id]);
        for (let depth = 0; depth < 20; depth++) {
            const previous = children.size;
            for (const s of this.sessions.values())
                if (s.tool === main.tool && s.parentId && children.has(s.parentId))
                    children.add(s.id);
            if (children.size === previous)
                break;
        }
        const agents = [...this.sessions.values()].filter(s => s.tool === main.tool && s.id !== main.id && children.has(s.id));
        const all = [main, ...agents], rows = mergeRequests(all.flatMap(s => s.requests)), complete = all.every(s => s.complete);
        const mainIds = new Set(main.requests.map(r => r.id));
        return { session, context: buildContext({ used: null, capacity: null, budget: { tokens: null, source: 'Client context measurement unavailable', accuracy: 'unknown', scope: 'total' }, view }),
            totals: { main: sumRequests(main.requests, main.complete), agents: sumRequests(agents.flatMap(s => s.requests).filter(r => !mainIds.has(r.id)), agents.every(s => s.complete)), all: sumRequests(rows, complete), agentCount: agents.length },
            cache: { state: 'unknown', source: 'Client cache validity unavailable', accuracy: 'unknown', expiresAt: null },
            cost: estimateCost(rows, readPrices(), complete), nativeCostUsd: null, warnings: [], capturedAt: new Date().toISOString() };
    }
}
//# sourceMappingURL=cost-history.js.map