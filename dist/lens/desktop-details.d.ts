import type { ActivityKind, HudSnapshot } from './types.js';
interface Options {
    session(): string;
    request<T>(url: string): Promise<T>;
    fit(): void;
    scroll(node: HTMLElement): void;
    currentCost(): void;
}
export declare function createDetailsUI(options: Options): {
    update: (snapshot: HudSnapshot) => void;
    clear: () => void;
    enter(): void;
    cost(page: string): void;
    activity(kind: ActivityKind, history: boolean): void;
};
export {};
//# sourceMappingURL=desktop-details.d.ts.map