// DEBUG=context-lens (or DEBUG=*) logs to stderr, which `claude --debug` shows for the status line.
const enabled = process.env.DEBUG?.includes('context-lens') || process.env.DEBUG === '*';

export function createDebug(namespace: string) {
  return (msg: string, ...args: unknown[]): void => {
    if (enabled) console.error(`[context-lens:${namespace}] ${msg}`, ...args);
  };
}
