import type { Ask } from './channel.ts';
import type { GitStatus } from './git.ts';
export declare function parseJjOutput(stdout: string): GitStatus | null;
/** Null outside a jj repo, or when jj is missing or rejects the template: render nothing. */
export declare function getJjStatus(ask: Ask): Promise<GitStatus | null>;
//# sourceMappingURL=jj.d.ts.map