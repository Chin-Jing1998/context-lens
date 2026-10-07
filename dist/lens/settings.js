import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { getClaudeConfigDir, getClaudeConfigJsonPath } from '../claude-config-dir.js';
import { tokenNumber } from './context.js';
export const lensHome = () => path.resolve(process.env.CONTEXT_LENS_HOME || path.join(os.homedir(), '.config', 'context-lens'));
export const configPath = () => path.join(lensHome(), 'config.json');
export const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {};
// Claude-only marketplace installs still work without installing the Codex reader dependencies.
const require = createRequire(import.meta.url);
const parseToml = (text) => require('smol-toml').parse(text);
export function readDocument(file, toml = false) {
    const fd = fs.openSync(file, 'r');
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > 1024 * 1024)
            throw new Error('Configuration must be a regular file under 1 MiB');
        const text = fs.readFileSync(fd, 'utf8');
        return record(toml ? parseToml(text) : JSON.parse(text));
    }
    finally {
        fs.closeSync(fd);
    }
}
export function atomicJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        fs.renameSync(temp, file);
    }
    finally {
        if (fs.existsSync(temp))
            fs.unlinkSync(temp);
    }
}
export function validatePrices(value) {
    const raw = record(value);
    if (!/^[A-Z]{3}$/.test(raw.currency) || typeof raw.currency !== 'string')
        throw new Error('Currency must be three uppercase letters');
    if (!raw.prices || typeof raw.prices !== 'object' || Array.isArray(raw.prices))
        throw new Error('Prices must be a model-to-rate object');
    const prices = Object.create(null);
    const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
    if (Object.keys(raw.prices).length > 200)
        throw new Error('At most 200 model prices are supported');
    for (const [model, value] of Object.entries(raw.prices)) {
        if (!model || model.length > 160 || /[\x00-\x1f\x7f]/.test(model) || ['__proto__', 'constructor', 'prototype'].includes(model))
            throw new Error('Invalid model name');
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Each price must be an object');
        const rates = {};
        for (const [key, number] of Object.entries(value)) {
            if (!fields.includes(key) || typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1e9)
                throw new Error('Prices must be finite nonnegative amounts per million tokens');
            rates[key] = number;
        }
        prices[model] = rates;
    }
    return { currency: raw.currency, prices };
}
export function readPrices() {
    try {
        return validatePrices(readDocument(configPath()));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { currency: 'USD', prices: {} };
        throw error;
    }
}
export function tokenSetting(value, shorthand = false) {
    if (value === 'auto')
        return 'auto';
    if (typeof value === 'number')
        return tokenNumber(value) && value > 0 ? value : null;
    if (typeof value !== 'string')
        return null;
    const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(value.trim());
    if (!m || (!shorthand && m[2]))
        return null;
    let number = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1e6 : m[2] ? 1e3 : 1);
    if (shorthand && !m[2] && number >= 100 && number <= 1000)
        number *= 1000;
    return tokenNumber(number) && number > 0 ? number : null;
}
export function launchSettings(client, argv) {
    const result = { overrides: {} };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--')
            break;
        const [flag, inline] = arg.split(/=(.*)/s);
        if (client === 'claude' && flag === '--autocompact') {
            const v = tokenSetting(inline ?? argv[++i], true);
            if (v !== null)
                result.autoCompact = v;
        }
        else if (client === 'codex' && (flag === '-p' || flag === '--profile'))
            result.profile = inline ?? argv[++i];
        else if (client === 'codex' && (flag === '-c' || flag === '--config')) {
            const assignment = inline ?? argv[++i];
            if (!assignment)
                continue;
            try {
                const parsed = parseToml(assignment);
                for (const key of ['model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'model_context_window'])
                    if (Object.hasOwn(parsed, key))
                        result.overrides[key] = parsed[key];
            }
            catch { /* The native CLI will reject invalid TOML. Do not infer a value. */ }
        }
    }
    return result;
}
function optional(file, warnings, toml = false) {
    try {
        return readDocument(file, toml);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            warnings.push(`Could not parse settings: ${file}`);
        return {};
    }
}
const enabled = (v) => typeof v === 'string' && !['', '0', 'false', 'off'].includes(v.toLowerCase());
export function resolveClaudeSettings(args) {
    const warnings = [];
    const env = args.env ?? process.env;
    const root = getClaudeConfigDir(os.homedir());
    const managed = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32'
        ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'ClaudeCode') : '/etc/claude-code';
    const files = args.files ?? [path.join(root, 'settings.json'), path.join(args.cwd, '.claude', 'settings.json'),
        path.join(args.cwd, '.claude', 'settings.local.json'), path.join(managed, 'managed-settings.json')];
    let configured = null;
    let source = 'Client model capacity; tuned threshold not reported';
    let disabled = args.launch?.disabled ?? false;
    const model = args.model.replace(/\[(?:1m|200k)\]/gi, '').replace(/(?:-|@)\d{8}$/, '');
    for (const file of files) {
        const data = optional(file, warnings);
        if (data.autoCompactEnabled === false)
            disabled = true;
        if (data.autoCompactEnabled === true)
            disabled = false;
        const perModel = record(record(data.modelSettings)[model]);
        const value = Object.hasOwn(perModel, 'autoCompactWindow') ? perModel.autoCompactWindow : data.autoCompactWindow;
        const setting = tokenSetting(value);
        if (setting !== null) {
            configured = setting;
            source = `${file}${Object.hasOwn(perModel, 'autoCompactWindow') ? `: modelSettings.${model}` : ': autoCompactWindow'}`;
        }
    }
    const global = optional(args.globalFile ?? getClaudeConfigJsonPath(os.homedir()), warnings);
    if (global.autoCompactEnabled === false)
        disabled = true;
    if (args.launch?.autoCompact !== undefined) {
        configured = args.launch.autoCompact;
        source = 'Claude launch --autocompact';
    }
    const environmental = tokenSetting(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
    if (typeof environmental === 'number') {
        configured = environmental;
        source = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
    }
    if (enabled(env.DISABLE_AUTO_COMPACT) || enabled(env.DISABLE_COMPACT)) {
        disabled = true;
        source = 'DISABLE_AUTO_COMPACT / DISABLE_COMPACT';
    }
    const capacity = tokenNumber(args.capacity);
    let tokens = typeof configured === 'number' ? configured : capacity;
    let accuracy = typeof configured === 'number' || disabled ? 'configured' : 'estimated';
    if (!disabled && typeof configured !== 'number' && capacity === 1000000) {
        tokens = 967000;
        source += '; native 1M default ≈967k';
    }
    if (disabled) {
        tokens = capacity;
        source += '; auto-compaction disabled';
    }
    if (tokens === null)
        accuracy = 'unknown';
    if (accuracy === 'estimated')
        warnings.push('Default compaction threshold is estimated; set an explicit autocompact window for an exact configured budget');
    return { capacity, budget: { tokens, source, accuracy, disabled, scope: 'total' }, warnings };
}
export function resolveCodexSettings(args) {
    const warnings = [];
    const root = args.home ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const file = path.join(root, 'config.toml');
    const base = optional(file, warnings, true);
    let data = { ...base };
    const sources = {};
    const apply = (values, source) => {
        for (const key of ['model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'model_context_window'])
            if (Object.hasOwn(values, key)) {
                data[key] = values[key];
                sources[key] = source;
            }
    };
    apply(base, file);
    const profile = args.launch?.profile ?? base.profile;
    if (typeof profile === 'string' && /^[\w.-]+$/.test(profile)) {
        apply(record(record(base.profiles)[profile]), `${file}: profiles.${profile}`);
        const profileFile = path.join(root, `${profile}.config.toml`);
        apply(optional(profileFile, warnings, true), profileFile);
    }
    const ancestors = [];
    if (args.cwd)
        for (let dir = path.resolve(args.cwd);; dir = path.dirname(dir)) {
            ancestors.unshift(dir);
            if (path.dirname(dir) === dir)
                break;
        }
    let trusted = false;
    for (const dir of ancestors) {
        const trust = record(record(base.projects)[dir]).trust_level;
        if (trust)
            trusted = trust === 'trusted';
        if (!trusted)
            continue;
        const local = path.join(dir, '.codex', 'config.toml');
        if (fs.existsSync(local))
            apply(optional(local, warnings, true), local);
    }
    if (args.launch?.overrides)
        apply(args.launch.overrides, 'Codex launch -c overrides');
    if (args.runtime)
        apply(args.runtime, 'Codex session runtime metadata');
    const capacity = tokenNumber(args.capacity) ?? tokenNumber(data.model_context_window);
    const rawLimit = tokenNumber(data.model_auto_compact_token_limit);
    const limit = rawLimit !== null && rawLimit > 0 ? rawLimit : null;
    if (limit === null)
        warnings.push('Runtime auto-compaction default is not recorded; showing the reported model window as an estimate');
    if (!args.launch)
        warnings.push('Saved Codex settings; launch/profile overrides may differ from this running session');
    return { capacity, warnings, budget: { tokens: limit ?? capacity,
            source: limit === null ? 'Reported model window; auto-compaction threshold unavailable' : sources.model_auto_compact_token_limit,
            accuracy: limit === null ? 'estimated' : sources.model_auto_compact_token_limit === 'Codex session runtime metadata' ? 'reported' : 'configured',
            scope: data.model_auto_compact_token_limit_scope === 'body_after_prefix' ? 'body_after_prefix' : 'total' } };
}
//# sourceMappingURL=settings.js.map