import * as fs from 'node:fs';
let input;
const waiting = new Map();
let nextId = 0;
function send(message) {
    const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
    for (let written = 0; written < bytes.length;)
        written += fs.writeSync(1, bytes, written);
}
function receive(line) {
    const message = JSON.parse(line);
    if (typeof message.id === 'number') {
        waiting.get(message.id)?.(message.answers ?? {});
        waiting.delete(message.id);
    }
    else {
        input?.(message);
        input = undefined;
    }
}
// Reads until hud closes fd 0, which it does once it has the output.
function readLoop() {
    const chunk = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0);
    const next = () => fs.read(0, chunk, 0, chunk.length, null, (error, bytesRead) => {
        if (error || bytesRead === 0)
            return;
        pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
        for (let newline = pending.indexOf(10); newline !== -1; newline = pending.indexOf(10)) {
            receive(pending.subarray(0, newline).toString('utf8'));
            pending = pending.subarray(newline + 1);
        }
        next();
    });
    next();
}
export function open() {
    const first = new Promise((resolve) => { input = resolve; });
    readLoop();
    return first;
}
export const ask = (probes) => new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, ask: probes });
});
export function finish(output) {
    send(output);
}
//# sourceMappingURL=channel.js.map