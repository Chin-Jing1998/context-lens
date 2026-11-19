export type WireValue = number | Uint8Array;
export declare function readVarint(bytes: Uint8Array, offset: number): [number, number];
export declare function fields(bytes: Uint8Array, wanted: readonly number[]): Map<number, WireValue>;
export declare function nested(value: WireValue | undefined, wanted: readonly number[]): Map<number, WireValue>;
export declare function messages(value: WireValue | undefined, field: number): Generator<Uint8Array>;
export declare function string(value: WireValue | undefined): string;
export declare function timestamp(value: WireValue | undefined): string | undefined;
//# sourceMappingURL=agy-wire.d.ts.map