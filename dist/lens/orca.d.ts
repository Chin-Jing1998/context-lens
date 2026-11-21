import { type OrcaSession } from './orca-session.js';
export declare function isOrcaApp(command: string): boolean;
export declare function isOrcaTerminalHost(command: string): boolean;
export declare function withinWorkspace(cwd: string, workspace: string): boolean;
export declare function useWindowsOrcaInstall(executable: string | undefined): void;
declare function orcaResult(args: string[]): Record<string, any>;
export interface OrcaWorkspace {
    id: string;
    cwd: string;
    terminals: number;
    wslDistro?: string;
}
export type OrcaSelection = {
    kind: 'terminal';
    tabId: string;
} | {
    kind: 'agent-session';
    sessionId: string | null;
} | {
    kind: 'other';
};
export declare function orcaWorkspace(data?: Record<string, any>): OrcaWorkspace | undefined;
/** 读取 Orca 当前活动工作区的前台选项卡类型与标识（终端或结构化代理对话）。 */
export declare function orcaForegroundSelection(workspace: OrcaWorkspace, root?: string | undefined): OrcaSelection | undefined;
/** 终端布局只记录终端选项卡。当前 Orca 配置可进一步确认用户选中的选项卡。 */
export declare function orcaSelectedTab(workspace: OrcaWorkspace, root?: string | undefined): string | null | undefined;
/** 将 Orca 本机结构化代理会话标识映射为 Context Lens 会话键。 */
export declare function orcaAgentSessionKey(workspace: OrcaWorkspace, sessionId: string, root?: string | undefined): string | null;
export declare function orcaPaneAgent(workspace: OrcaWorkspace, tab: string, read?: typeof orcaResult): OrcaSession | undefined;
export declare function orcaPanePid(workspace: OrcaWorkspace, read?: typeof orcaResult, selectedTab?: string): number | undefined;
export {};
//# sourceMappingURL=orca.d.ts.map