import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { SessionCollector } from './snapshot.js';
import { sessionKey } from './sessions.js';
import { renderLensLines } from './terminal.js';
import { startServer } from './server.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
const help = `Context Lens
  context-lens desktop [--port 47831] [--install]
  context-lens serve [--port 47831]
  context-lens list [--client claude|codex] [--json]
  context-lens watch --session codex:<session-id> [--view budget|model] [--once] [--json]
  context-lens watch [--client claude|codex] [--cwd <project>]  (interactive selector)
  context-lens codex -- <native Codex arguments>

Settings: ~/.config/context-lens/config.json (or CONTEXT_LENS_HOME)
Desktop: independent macOS floating ball; --install adds the app and its login watcher.
Codex keeps the official CLI and its native status line in the original terminal position.
The watcher exits with q / Ctrl+C; it does not terminate the native CLI.
`;
async function chooseSession(collector, client, cwd) {
    if (!process.stdin.isTTY)
        throw new Error('Specify --session claude:<id> or codex:<id>; use "context-lens list" to find it');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        for (;;) {
            const files = collector.list(true).filter(f => !f.parentId && (!client || f.client === client) && (!cwd || path.resolve(f.cwd) === path.resolve(cwd))).slice(0, 12);
            console.log('Context Lens · select a session (never binds to the most recently modified log automatically)');
            for (const [i, file] of files.entries())
                console.log(`${i + 1}. ${file.client} ${file.id} · ${sanitizeDisplayText(path.basename(file.cwd))}`);
            if (!files.length)
                console.log('No matching session yet. Start the CLI, then enter r to refresh.');
            const answer = (await rl.question('Session number / r refresh / q quit: ')).trim();
            if (answer === 'q')
                throw new Error('Session selection cancelled');
            if (/^\d+$/.test(answer) && files[Number(answer) - 1])
                return sessionKey(files[Number(answer) - 1]);
        }
    }
    finally {
        rl.close();
    }
}
export async function launchCodex(args) {
    await new Promise((resolve, reject) => {
        const child = spawn('codex', args, { stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); });
    });
}
export async function runCli(argv = process.argv.slice(2)) {
    const separator = argv.indexOf('--');
    const native = separator < 0 ? [] : argv.slice(separator + 1);
    const { values, positionals } = parseArgs({ args: separator < 0 ? argv : argv.slice(0, separator), allowPositionals: true, options: {
            help: { type: 'boolean', short: 'h' }, port: { type: 'string' }, session: { type: 'string' }, client: { type: 'string' },
            cwd: { type: 'string' }, once: { type: 'boolean' }, json: { type: 'boolean' }, view: { type: 'string' }, install: { type: 'boolean' },
        } });
    const command = positionals[0];
    if (values.help || !command) {
        console.log(help);
        return;
    }
    if (values.client && !['claude', 'codex'].includes(values.client))
        throw new Error('--client must be claude or codex');
    if (values.view && !['budget', 'model'].includes(values.view))
        throw new Error('--view must be budget or model');
    if (command === 'codex') {
        await launchCodex(native);
        return;
    }
    if (command === 'desktop') {
        const script = fileURLToPath(new URL('../../scripts/build-desktop.mjs', import.meta.url));
        execFileSync(process.execPath, [script, ...(values.install ? ['--install'] : []), '--port', values.port ?? '47831', '--open'], { stdio: 'inherit' });
        return;
    }
    if (command === 'serve') {
        const port = values.port === undefined ? 47831 : Number(values.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535)
            throw new Error('Port must be an integer from 0 to 65535');
        const { url } = await startServer({ port });
        console.log(`Context Lens: ${url}\nOpen this URL in the Claude Code or Codex desktop browser panel. Press Ctrl+C to stop.`);
        return;
    }
    const collector = new SessionCollector();
    if (command === 'list') {
        const sessions = collector.list().filter(s => !values.client || s.client === values.client)
            .map(({ id, client, cwd, updatedAt, parentId }) => ({ key: sessionKey({ id, client }), client, cwd, updatedAt, parentId }));
        console.log(values.json ? JSON.stringify(sessions) : sessions.map(s => `${s.key}\t${sanitizeDisplayText(s.cwd)}${s.parentId ? ` (agent of ${s.parentId})` : ''}`).join('\n'));
        return;
    }
    if (command !== 'watch')
        throw new Error(`Unknown command.\n${help}`);
    const session = values.session || await chooseSession(collector, values.client, values.cwd);
    let launch;
    if (process.env.CONTEXT_LENS_LAUNCH) {
        try {
            launch = JSON.parse(process.env.CONTEXT_LENS_LAUNCH);
        }
        catch {
            throw new Error('Invalid launcher settings');
        }
    }
    const snapshot = () => collector.get(session, { view: values.view === 'model' ? 'model' : 'budget', launch });
    if (values.once) {
        const data = await snapshot();
        console.log(values.json ? JSON.stringify(data) : renderLensLines(data, process.stdout.columns || 100).join('\n'));
        return;
    }
    let stopped = false;
    const stop = () => { stopped = true; };
    const key = (chunk) => { if (chunk.toString().includes('q') || chunk.includes(3))
        stop(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const interactive = process.stdout.isTTY && !values.json;
    if (interactive)
        process.stdout.write('\x1b[?1049h');
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.on('data', key);
        process.stdin.resume();
    }
    try {
        while (!stopped) {
            try {
                const data = await snapshot();
                if (values.json)
                    console.log(JSON.stringify(data));
                else {
                    if (interactive)
                        process.stdout.write('\x1b[H\x1b[2J');
                    console.log(renderLensLines(data, process.stdout.columns || 100).join('\n'));
                }
            }
            catch (error) {
                console.error(sanitizeDisplayText(error.message));
            }
            if (!stopped)
                await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    finally {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.off('data', key);
            process.stdin.pause();
        }
        if (interactive)
            process.stdout.write('\x1b[?1049l');
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
    }
}
//# sourceMappingURL=cli.js.map