import * as http from 'node:http';
import { SessionCollector } from './snapshot.js';
import { CostHistory } from './cost-history.js';
export declare function startServer(options?: {
    port?: number;
    collector?: SessionCollector;
    pricingRefresh?: boolean;
    costHistory?: CostHistory;
}): Promise<{
    server: http.Server;
    url: string;
}>;
//# sourceMappingURL=server.d.ts.map