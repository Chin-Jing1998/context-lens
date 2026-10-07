export declare const updateSource = "https://github.com/Chin-Jing1998/context-lens";
export declare const currentVersion: string;
export interface UpdateInfo {
    current: string;
    latest: string | null;
    available: boolean;
    state: 'idle' | 'current' | 'available' | 'unpublished';
    source: string;
    release: string | null;
    publishedAt: string | null;
}
export declare function newerVersion(candidate: string, current: string): boolean;
export declare const updateInfo: () => UpdateInfo;
export declare function checkUpdates(request?: typeof fetch): Promise<UpdateInfo>;
//# sourceMappingURL=updates.d.ts.map