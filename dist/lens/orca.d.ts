export declare function isOrcaApp(command: string): boolean;
export declare function isOrcaTerminalHost(command: string): boolean;
export declare function withinWorkspace(cwd: string, workspace: string): boolean;
declare function orcaResult(args: string[]): Record<string, any>;
interface OrcaWorkspace {
    id: string;
    cwd: string;
    terminals: number;
}
export declare function orcaWorkspace(data?: Record<string, any>): OrcaWorkspace | undefined;
/** 终端布局只记录终端选项卡。当前 Orca 配置可进一步确认用户选中的选项卡。 */
export declare function orcaSelectedTab(workspace: OrcaWorkspace): string | null | undefined;
export declare function orcaPanePid(workspace: OrcaWorkspace, read?: typeof orcaResult, selectedTab?: string): number | undefined;
export {};
//# sourceMappingURL=orca.d.ts.map