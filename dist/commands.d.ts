import type { Input, Output } from "./channel.ts";
import { type HudConfig, type LoadedConfig } from "./config.ts";
import type { StdinData } from "./types.ts";
import type { Sources } from "./main.ts";
type Render = (stdin: StdinData, config: HudConfig, sources: Sources) => Promise<Output>;
type Raw = Record<string, unknown>;
export declare const mask: (text: string) => string;
export declare function scrubStdin(value: unknown, at?: string): unknown;
/** The keys that differ from the defaults, with the user's own words masked. */
export declare function scrubConfig(config: HudConfig): Raw;
export declare function runCommand(input: Input, loaded: LoadedConfig, render: Render, ask: Sources["ask"]): Promise<Output>;
export {};
//# sourceMappingURL=commands.d.ts.map