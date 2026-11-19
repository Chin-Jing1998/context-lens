import type { MemoryInfo } from './types.ts';
type RawMemory = {
    totalBytes: number;
    freeBytes: number;
};
/** The `memory` probe's answer: /proc/meminfo on Linux, vm_stat output on macOS. */
export type MemoryFacts = {
    meminfo?: string | null;
    vmStat?: string | null;
} | null | undefined;
export declare function parseVmStat(output: string): {
    pageSize: number;
    active: number;
    wired: number;
} | null;
export declare function parseLinuxMeminfo(output: string): RawMemory | null;
export declare function readMemory(facts: MemoryFacts): RawMemory;
export declare function getMemoryUsage({ totalBytes, freeBytes }: RawMemory): MemoryInfo | null;
export declare function formatBytes(bytes: number): string;
export {};
//# sourceMappingURL=memory.d.ts.map