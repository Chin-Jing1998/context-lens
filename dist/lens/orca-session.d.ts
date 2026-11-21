import type { DatabaseSync } from 'node:sqlite';
export declare function defaultOrcaRoot(platform?: NodeJS.Platform, home?: string, appData?: string | undefined): string | undefined;
export declare function openReadOnlyDb(file: string): DatabaseSync;
export interface OrcaFacts {
    kind: 'report' | 'estimate' | 'unknown';
    at: number;
    used: number | null;
    window: number | null;
    percent?: number;
    threshold?: number;
    model?: string;
    categories?: {
        name: string;
        tokens: number;
    }[];
}
export interface OrcaSession {
    id: string;
    agent: string;
    workspaceId: string;
    nativeKey: string | null;
    title: string;
    model: string;
    effort: string;
    state: string;
    createdAt: number | null;
    updatedAt: number | null;
    facts?: OrcaFacts;
}
/** 仅将 Orca 当前记录所属发行版的本地路径映射到 Windows。 */
export declare function orcaLocalPath(value: unknown, distro: unknown, platform?: NodeJS.Platform): string | undefined;
export declare function registerWslHome(distro: string): void;
export declare function terminalNativeKey(root: string | undefined, id: string, agent: string, distro?: string): string | null;
export declare function orcaAccountRoots(root?: string | undefined): {
    claude: string[];
    codex: string[];
    agy: string[];
};
export declare function readOrcaSession(id: string, workspaceId?: string, root?: string | undefined, withFacts?: boolean): OrcaSession | undefined;
//# sourceMappingURL=orca-session.d.ts.map