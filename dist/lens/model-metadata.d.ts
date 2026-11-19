/** Recognize only verified IDs and the explicitly supported provider/resource prefixes. */
export declare function officialModelMetadata(model: string | undefined): {
    readonly id: 'gemini-4-argon';
    readonly capacity: 1048576;
    readonly source: 'https://ai.google.dev/gemini-api/docs/models/gemini-4-argon';
    readonly checkedAt: '2026-10-19T02:36:48Z';
} | undefined;
/** 仅展开已知厂商命名空间、官方显示名和有日期的模型快照。 */
export declare function priceModelIds(model: string): string[];
//# sourceMappingURL=model-metadata.d.ts.map