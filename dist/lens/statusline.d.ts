import type { StdinData } from '../types.js';
interface CaptureAccountOptions {
    path: string;
    showAuth: boolean;
    showAuthUser: boolean;
    authUserFullEmail: boolean;
    authUserLength?: number;
}
export declare function captureStatusline(stdin: StdinData, showTerminal: boolean, hudWindow: number | null, account?: CaptureAccountOptions): number | null;
export declare function extendedStatusline(stdin: StdinData, columns: number): Promise<string[]>;
export {};
//# sourceMappingURL=statusline.d.ts.map