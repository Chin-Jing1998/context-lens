import { type WireValue } from './agy-wire.js';
import type { Category, Measurement, MessageSegment } from './types.js';
export declare function agyContextBreakdown(data: WireValue | undefined, used: number, at: string): {
    categories: Partial<Record<Category, Measurement>>;
    messageBreakdown?: MessageSegment[];
} | undefined;
//# sourceMappingURL=agy-context.d.ts.map