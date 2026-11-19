import type { PriceCatalog } from './pricing.js';

// 官方文本 token 价格。历史保留条目标注原核验时间。
export const BUNDLED_PRICES: PriceCatalog = {
  google: {
    source: "https://aistudio.google.com/docs/pricing",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "gemini-4-carbon": {
        rates: { input: 2, output: 10, cacheRead: 0.1 },
        dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 4, output: 20, cacheRead: 0.2 } },
        tiers: {
          "batch": {
            rates: { input: 1, output: 5, cacheRead: 0.05 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 2, output: 10, cacheRead: 0.1 } },
          },
          "flex": {
            rates: { input: 1, output: 5, cacheRead: 0.05 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 2, output: 10, cacheRead: 0.1 } },
          },
          "priority": {
            rates: { input: 3.6, output: 18, cacheRead: 0.18 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 7.2, output: 36, cacheRead: 0.36 } },
          },
        },
      },
      "gemini-4-argon": {
        rates: { input: 2, output: 10, cacheRead: 0.1 },
        dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 4, output: 20, cacheRead: 0.2 } },
        tiers: {
          "batch": {
            rates: { input: 1, output: 5, cacheRead: 0.05 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 2, output: 10, cacheRead: 0.1 } },
          },
          "flex": {
            rates: { input: 1, output: 5, cacheRead: 0.05 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 2, output: 10, cacheRead: 0.1 } },
          },
          "priority": {
            rates: { input: 3.6, output: 18, cacheRead: 0.18 },
            dateChange: { at: "2026-12-01T00:00:00.000Z", rates: { input: 7.2, output: 36, cacheRead: 0.36 } },
          },
        },
      },
      "gemini-4-neon": {
        rates: { input: 3, output: 15, cacheRead: 0.15 },
        tiers: {
          "batch": { rates: { input: 1.5, output: 7.5, cacheRead: 0.075 } },
          "flex": { rates: { input: 1.5, output: 7.5, cacheRead: 0.075 } },
          "priority": { rates: { input: 5.4, output: 27, cacheRead: 0.27 } },
        },
      },
      "gemini-4-hydrogen": {
        rates: { input: 1.5, output: 7.5, cacheRead: 0.075 },
        tiers: {
          "batch": { rates: { input: 0.75, output: 3.75, cacheRead: 0.0375 } },
          "flex": { rates: { input: 0.75, output: 3.75, cacheRead: 0.0375 } },
          "priority": { rates: { input: 2.7, output: 13.5, cacheRead: 0.135 } },
        },
      },
      "gemini-3.8-flash": {
        rates: { input: 0.75, output: 3.75, cacheRead: 0.075 },
        dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 1.5, output: 7.5, cacheRead: 0.15 } },
        tiers: {
          "batch": {
            rates: { input: 0.375, output: 1.875, cacheRead: 0.0375 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 0.75, output: 3.75, cacheRead: 0.075 } },
          },
          "flex": {
            rates: { input: 0.375, output: 1.875, cacheRead: 0.0375 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 0.75, output: 3.75, cacheRead: 0.075 } },
          },
          "priority": {
            rates: { input: 1.35, output: 6.75, cacheRead: 0.135 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 2.7, output: 13.5, cacheRead: 0.27 } },
          },
        },
      },
      "gemini-3.6-flash": {
        rates: { input: 0.75, output: 3.75, cacheRead: 0.075 },
        dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 1.5, output: 7.5, cacheRead: 0.15 } },
        tiers: {
          "batch": {
            rates: { input: 0.375, output: 1.875, cacheRead: 0.0375 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 0.75, output: 3.75, cacheRead: 0.075 } },
          },
          "flex": {
            rates: { input: 0.375, output: 1.875, cacheRead: 0.0375 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 0.75, output: 3.75, cacheRead: 0.075 } },
          },
          "priority": {
            rates: { input: 1.35, output: 6.75, cacheRead: 0.135 },
            dateChange: { at: "2027-01-01T00:00:00.000Z", rates: { input: 2.7, output: 13.5, cacheRead: 0.27 } },
          },
        },
      },
    },
  },
  openai: {
    source: "https://developers.openai.com/api/docs/pricing",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "gpt-6.2-astra": {
        rates: { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10, cacheWrite12h: 20 },
        longContext: { input: 16, output: 60, cacheRead: 0.8, cacheWrite: 20, cacheWrite12h: 40 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
            longContext: { input: 8, output: 30, cacheRead: 0.4, cacheWrite: 10, cacheWrite12h: 20 },
          },
          "fast": {
            rates: { input: 16, output: 80, cacheRead: 0.8, cacheWrite: 20, cacheWrite12h: 40 },
            longContext: { input: 32, output: 120, cacheRead: 1.6, cacheWrite: 40, cacheWrite12h: 80 },
          },
          "ultrafast": {
            rates: { input: 24, output: 120, cacheRead: 1.2, cacheWrite: 30, cacheWrite12h: 60 },
            longContext: { input: 48, output: 180, cacheRead: 2.4, cacheWrite: 60, cacheWrite12h: 120 },
            dateChange: { at: "2027-03-01T08:00:00.000Z", rates: { input: 48, output: 240, cacheRead: 2.4, cacheWrite: 60, cacheWrite12h: 120 }, longContext: { input: 96, output: 360, cacheRead: 4.8, cacheWrite: 120, cacheWrite12h: 240 } },
          },
        },
      },
      "gpt-6.2-sol": {
        rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
        longContext: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "fast": {
            rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
            longContext: { input: 8, output: 30, cacheRead: 0.4, cacheWrite: 10, cacheWrite12h: 20 },
          },
          "ultrafast": {
            rates: { input: 6, output: 30, cacheRead: 0.3, cacheWrite: 7.5, cacheWrite12h: 15 },
            longContext: { input: 12, output: 45, cacheRead: 0.6, cacheWrite: 15, cacheWrite12h: 30 },
            dateChange: { at: "2027-03-01T08:00:00.000Z", rates: { input: 12, output: 60, cacheRead: 0.6, cacheWrite: 15, cacheWrite12h: 30 }, longContext: { input: 24, output: 90, cacheRead: 1.2, cacheWrite: 30, cacheWrite12h: 60 } },
          },
        },
      },
      "gpt-6-astra": {
        rates: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, cacheWrite12h: 25 },
        longContext: { input: 20, output: 75, cacheRead: 2, cacheWrite: 25, cacheWrite12h: 50 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite12h: 12.5 },
            longContext: { input: 10, output: 37.5, cacheRead: 1, cacheWrite: 12.5, cacheWrite12h: 25 },
          },
          "flex": {
            rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite12h: 12.5 },
            longContext: { input: 10, output: 37.5, cacheRead: 1, cacheWrite: 12.5, cacheWrite12h: 25 },
          },
          "fast": {
            rates: { input: 20, output: 100, cacheRead: 2, cacheWrite: 25, cacheWrite12h: 50 },
            longContext: { input: 40, output: 150, cacheRead: 4, cacheWrite: 50, cacheWrite12h: 100 },
          },
          "ultrafast": {
            rates: { input: 60, output: 300, cacheRead: 6, cacheWrite: 75, cacheWrite12h: 150 },
            longContext: { input: 120, output: 450, cacheRead: 12, cacheWrite: 150, cacheWrite12h: 300 },
          },
        },
      },
      "gpt-6.1-sol": {
        rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
        longContext: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "flex": {
            rates: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "fast": {
            rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
            longContext: { input: 8, output: 30, cacheRead: 0.4, cacheWrite: 10, cacheWrite12h: 20 },
          },
          "ultrafast": {
            rates: { input: 12, output: 60, cacheRead: 0.6, cacheWrite: 15, cacheWrite12h: 30 },
            longContext: { input: 24, output: 90, cacheRead: 1.2, cacheWrite: 30, cacheWrite12h: 60 },
          },
        },
      },
      "gpt-6.1-terra": {
        rates: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
        longContext: { input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 0.5, output: 2.5, cacheRead: 0.025, cacheWrite: 0.625, cacheWrite12h: 1.25 },
            longContext: { input: 1, output: 3.75, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
          },
          "flex": {
            rates: { input: 0.5, output: 2.5, cacheRead: 0.025, cacheWrite: 0.625, cacheWrite12h: 1.25 },
            longContext: { input: 1, output: 3.75, cacheRead: 0.05, cacheWrite: 1.25, cacheWrite12h: 2.5 },
          },
          "fast": {
            rates: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, cacheWrite12h: 5 },
            longContext: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5, cacheWrite12h: 10 },
          },
        },
      },
      "gpt-6-luna": {
        rates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25 },
        longContext: { input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25, cacheWrite12h: 0.5 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625, cacheWrite12h: 0.125 },
            longContext: { input: 0.1, output: 0.375, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25 },
          },
          "flex": {
            rates: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625, cacheWrite12h: 0.125 },
            longContext: { input: 0.1, output: 0.375, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25 },
          },
          "fast": {
            rates: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite: 0.25, cacheWrite12h: 0.5 },
            longContext: { input: 0.4, output: 1.5, cacheRead: 0.04, cacheWrite: 0.5, cacheWrite12h: 1 },
          },
        },
      },
      "gpt-6-sol": {
        rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
        longContext: { input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 7.5, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "flex": {
            rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 7.5, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "fast": {
            rates: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
            longContext: { input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10, cacheWrite12h: 20 },
          },
        },
      },
      "gpt-5.6-sol": {
        rates: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
        longContext: { input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10, cacheWrite12h: 20 },
        expiresAt: "2026-12-01T00:00:00.000Z",
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
            longContext: { input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
          },
          "flex": {
            rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
            longContext: { input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
          },
          "fast": {
            rates: { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10, cacheWrite12h: 20 },
            longContext: { input: 16, output: 60, cacheRead: 1.6, cacheWrite: 20, cacheWrite12h: 40 },
          },
        },
      },
      "gpt-5.6-terra": {
        rates: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
        longContext: { input: 4, output: 18, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 9, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "flex": {
            rates: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite12h: 2.5 },
            longContext: { input: 2, output: 9, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite12h: 5 },
          },
          "fast": {
            rates: { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 5, cacheWrite12h: 10 },
            longContext: { input: 8, output: 36, cacheRead: 0.8, cacheWrite: 10, cacheWrite12h: 20 },
          },
        },
      },
      "gpt-5.6-luna": {
        rates: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, cacheWrite12h: 0.5 },
        longContext: { input: 0.4, output: 1.8, cacheRead: 0.04, cacheWrite: 0.5, cacheWrite12h: 1 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25 },
            longContext: { input: 0.2, output: 0.9, cacheRead: 0.02, cacheWrite: 0.25, cacheWrite12h: 0.5 },
          },
          "flex": {
            rates: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite12h: 0.25 },
            longContext: { input: 0.2, output: 0.9, cacheRead: 0.02, cacheWrite: 0.25, cacheWrite12h: 0.5 },
          },
          "fast": {
            rates: { input: 0.4, output: 2.4, cacheRead: 0.04, cacheWrite: 0.5, cacheWrite12h: 1 },
            longContext: { input: 0.8, output: 3.6, cacheRead: 0.08, cacheWrite: 1, cacheWrite12h: 2 },
          },
        },
      },
      "gpt-5.5": {
        rates: { input: 5, output: 30, cacheRead: 0.5 },
        longContext: { input: 10, output: 45, cacheRead: 1 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 2.5, output: 15, cacheRead: 0.25 },
            longContext: { input: 5, output: 22.5, cacheRead: 0.5 },
          },
          "flex": {
            rates: { input: 2.5, output: 15, cacheRead: 0.25 },
            longContext: { input: 5, output: 22.5, cacheRead: 0.5 },
          },
          "fast": { rates: { input: 12.5, output: 75, cacheRead: 1.25 } },
        },
      },
      "gpt-5.5-pro": {
        rates: { input: 30, output: 180 },
        longContext: { input: 60, output: 270 },
        threshold: 272000,
        tiers: {
          "batch": { rates: { input: 15, output: 90 } },
          "flex": { rates: { input: 15, output: 90 } },
        },
      },
      "gpt-5.4": {
        rates: { input: 2.5, output: 15, cacheRead: 0.25 },
        longContext: { input: 5, output: 22.5, cacheRead: 0.5 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 1.25, output: 7.5, cacheRead: 0.13 },
            longContext: { input: 2.5, output: 11.25, cacheRead: 0.25 },
          },
          "flex": {
            rates: { input: 1.25, output: 7.5, cacheRead: 0.13 },
            longContext: { input: 2.5, output: 11.25, cacheRead: 0.25 },
          },
          "fast": { rates: { input: 5, output: 30, cacheRead: 0.5 } },
        },
      },
      "gpt-5.4-pro": {
        rates: { input: 30, output: 180 },
        longContext: { input: 60, output: 270 },
        threshold: 272000,
        tiers: {
          "batch": {
            rates: { input: 15, output: 90 },
            longContext: { input: 30, output: 135 },
          },
          "flex": {
            rates: { input: 15, output: 90 },
            longContext: { input: 30, output: 135 },
          },
        },
      },
      "gpt-5.4-mini": {
        rates: { input: 0.75, output: 4.5, cacheRead: 0.075 },
        tiers: {
          "batch": { rates: { input: 0.375, output: 2.25, cacheRead: 0.0375 } },
          "flex": { rates: { input: 0.375, output: 2.25, cacheRead: 0.0375 } },
          "fast": { rates: { input: 1.5, output: 9, cacheRead: 0.15 } },
        },
      },
      "gpt-5.4-nano": {
        rates: { input: 0.2, output: 1.25, cacheRead: 0.02 },
        tiers: {
          "batch": { rates: { input: 0.1, output: 0.625, cacheRead: 0.01 } },
          "flex": { rates: { input: 0.1, output: 0.625, cacheRead: 0.01 } },
        },
      },
      "gpt-5.2": {
        rates: { input: 1.75, output: 14, cacheRead: 0.175 },
        tiers: {
          "batch": { rates: { input: 0.875, output: 7, cacheRead: 0.0875 } },
          "flex": { rates: { input: 0.875, output: 7, cacheRead: 0.0875 } },
          "fast": { rates: { input: 3.5, output: 28, cacheRead: 0.35 } },
        },
      },
      "gpt-5.2-pro": {
        rates: { input: 21, output: 168 },
        tiers: {
          "batch": { rates: { input: 10.5, output: 84 } },
        },
      },
      "gpt-5.1": {
        rates: { input: 1.25, output: 10, cacheRead: 0.125 },
        tiers: {
          "batch": { rates: { input: 0.625, output: 5, cacheRead: 0.0625 } },
          "flex": { rates: { input: 0.625, output: 5, cacheRead: 0.0625 } },
          "fast": { rates: { input: 2.5, output: 20, cacheRead: 0.25 } },
        },
      },
      "gpt-5": {
        rates: { input: 1.25, output: 10, cacheRead: 0.125 },
        tiers: {
          "batch": { rates: { input: 0.625, output: 5, cacheRead: 0.0625 } },
          "flex": { rates: { input: 0.625, output: 5, cacheRead: 0.0625 } },
          "fast": { rates: { input: 2.5, output: 20, cacheRead: 0.25 } },
        },
      },
      "gpt-5-mini": {
        rates: { input: 0.25, output: 2, cacheRead: 0.025 },
        tiers: {
          "batch": { rates: { input: 0.125, output: 1, cacheRead: 0.0125 } },
          "flex": { rates: { input: 0.125, output: 1, cacheRead: 0.0125 } },
          "fast": { rates: { input: 0.45, output: 3.6, cacheRead: 0.045 } },
        },
      },
      "gpt-5-nano": {
        rates: { input: 0.05, output: 0.4, cacheRead: 0.005 },
        tiers: {
          "batch": { rates: { input: 0.025, output: 0.2, cacheRead: 0.0025 } },
          "flex": { rates: { input: 0.025, output: 0.2, cacheRead: 0.0025 } },
        },
      },
      "gpt-5-pro": {
        rates: { input: 15, output: 120 },
        tiers: {
          "batch": { rates: { input: 7.5, output: 60 } },
        },
      },
      "gpt-4.1": {
        rates: { input: 2, output: 8, cacheRead: 0.5 },
        tiers: {
          "batch": { rates: { input: 1, output: 4 } },
          "fast": { rates: { input: 3.5, output: 14, cacheRead: 0.875 } },
        },
      },
      "gpt-4.1-mini": {
        rates: { input: 0.4, output: 1.6, cacheRead: 0.1 },
        tiers: {
          "batch": { rates: { input: 0.2, output: 0.8 } },
          "fast": { rates: { input: 0.7, output: 2.8, cacheRead: 0.175 } },
        },
      },
      "gpt-4o": {
        rates: { input: 2.5, output: 10, cacheRead: 1.25 },
        tiers: {
          "batch": { rates: { input: 1.25, output: 5 } },
          "fast": { rates: { input: 4.25, output: 17, cacheRead: 2.125 } },
        },
      },
      "gpt-4o-mini": {
        rates: { input: 0.15, output: 0.6, cacheRead: 0.075 },
        tiers: {
          "batch": { rates: { input: 0.075, output: 0.3 } },
          "fast": { rates: { input: 0.25, output: 1, cacheRead: 0.125 } },
        },
      },
      "o3-pro": {
        rates: { input: 20, output: 80 },
        tiers: {
          "batch": { rates: { input: 10, output: 40 } },
        },
      },
      "o3": {
        rates: { input: 2, output: 8, cacheRead: 0.5 },
        tiers: {
          "batch": { rates: { input: 1, output: 4 } },
          "flex": { rates: { input: 1, output: 4, cacheRead: 0.25 } },
          "fast": { rates: { input: 3.5, output: 14, cacheRead: 0.875 } },
        },
      },
      "gpt-4.1-nano": {
        rates: { input: 0.1, cacheRead: 0.025, output: 0.4 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 0.05, output: 0.2 } },
          "fast": { rates: { input: 0.2, cacheRead: 0.05, output: 0.8 } },
        },
      },
      "gpt-4o-2024-05-13": {
        rates: { input: 5, output: 15 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 2.5, output: 7.5 } },
          "fast": { rates: { input: 8.75, output: 26.25 } },
        },
      },
      "o1": {
        rates: { input: 15, cacheRead: 7.5, output: 60 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 7.5, output: 30 } },
        },
      },
      "o1-pro": {
        rates: { input: 150, output: 600 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 75, output: 300 } },
        },
      },
      "o4-mini": {
        rates: { input: 1.1, cacheRead: 0.275, output: 4.4 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 0.55, output: 2.2 } },
          "flex": { rates: { input: 0.55, cacheRead: 0.138, output: 2.2 } },
          "fast": { rates: { input: 2, cacheRead: 0.5, output: 8 } },
        },
      },
      "o3-mini": {
        rates: { input: 1.1, cacheRead: 0.55, output: 4.4 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 0.55, output: 2.2 } },
        },
      },
      "gpt-4-turbo-2024-04-09": {
        rates: { input: 10, output: 30 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 5, output: 15 } },
        },
      },
      "gpt-4-0613": {
        rates: { input: 30, output: 60 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 15, output: 30 } },
        },
      },
      "gpt-3.5-turbo": { rates: { input: 0.5, output: 1.5 }, threshold: 272000, checkedAt: "2026-10-05T11:15:18.000Z" },
      "gpt-3.5-turbo-0125": {
        rates: { input: 0.5, output: 1.5 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 0.25, output: 0.75 } },
        },
      },
      "gpt-3.5-turbo-1106": {
        rates: { input: 1, output: 2 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 1, output: 2 } },
        },
      },
      "gpt-3.5-turbo-instruct": { rates: { input: 1.5, output: 2 }, threshold: 272000, checkedAt: "2026-10-05T11:15:18.000Z" },
      "davinci-002": {
        rates: { input: 2, output: 2 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 1, output: 1 } },
        },
      },
      "babbage-002": {
        rates: { input: 0.4, output: 0.4 },
        threshold: 272000,
        checkedAt: "2026-10-05T11:15:18.000Z",
        tiers: {
          "batch": { rates: { input: 0.2, output: 0.2 } },
        },
      },
    },
  },
  anthropic: {
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "claude-fable-5-2": {
        rates: { input: 8, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.2, output: 40, cacheWrite: 10 },
        tiers: {
          "fast": { rates: { input: 16, cacheWrite5m: 20, cacheWrite1h: 32, cacheRead: 0.4, output: 80, cacheWrite: 20 } },
          "batch": { rates: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.1, output: 20, cacheWrite: 5 } },
        },
      },
      "claude-mythos-5-2": {
        rates: { input: 8, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.2, output: 40, cacheWrite: 10 },
        tiers: {
          "fast": { rates: { input: 16, cacheWrite5m: 20, cacheWrite1h: 32, cacheRead: 0.4, output: 80, cacheWrite: 20 } },
          "batch": { rates: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.1, output: 20, cacheWrite: 5 } },
        },
      },
      "claude-fable-5-1": {
        rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50, cacheWrite: 12.5 },
        tiers: {
          "batch": { rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.125, output: 25, cacheWrite: 6.25 } },
        },
      },
      "claude-mythos-5-1": {
        rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50, cacheWrite: 12.5 },
        tiers: {
          "batch": { rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.125, output: 25, cacheWrite: 6.25 } },
        },
      },
      "claude-fable-5": {
        rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50, cacheWrite: 12.5 },
        tiers: {
          "batch": { rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 } },
        },
      },
      "claude-mythos-5": {
        rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50, cacheWrite: 12.5 },
        tiers: {
          "batch": { rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 } },
        },
      },
      "claude-opus-5-5": {
        rates: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20, cacheWrite: 5 },
        tiers: {
          "fast": { rates: { input: 8, cacheWrite5m: 10, cacheWrite1h: 16, cacheRead: 0.4, output: 40, cacheWrite: 10 } },
          "batch": { rates: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10, cacheWrite: 2.5 } },
        },
      },
      "claude-opus-5": {
        rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 },
        tiers: {
          "fast": { rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50, cacheWrite: 12.5 } },
          "batch": { rates: { input: 2.5, cacheWrite5m: 3.125, cacheWrite1h: 5, cacheRead: 0.25, output: 12.5, cacheWrite: 3.125 } },
        },
      },
      "claude-opus-4-8": {
        rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 },
        tiers: {
          "fast": { rates: { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50, cacheWrite: 12.5 } },
          "batch": { rates: { input: 2.5, cacheWrite5m: 3.125, cacheWrite1h: 5, cacheRead: 0.25, output: 12.5, cacheWrite: 3.125 } },
        },
      },
      "claude-opus-4-7": {
        rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 },
        tiers: {
          "batch": { rates: { input: 2.5, cacheWrite5m: 3.125, cacheWrite1h: 5, cacheRead: 0.25, output: 12.5, cacheWrite: 3.125 } },
        },
      },
      "claude-opus-4-6": {
        rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 },
        tiers: {
          "batch": { rates: { input: 2.5, cacheWrite5m: 3.125, cacheWrite1h: 5, cacheRead: 0.25, output: 12.5, cacheWrite: 3.125 } },
        },
      },
      "claude-opus-4-5": {
        rates: { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, cacheWrite: 6.25 },
        tiers: {
          "batch": { rates: { input: 2.5, cacheWrite5m: 3.125, cacheWrite1h: 5, cacheRead: 0.25, output: 12.5, cacheWrite: 3.125 } },
        },
      },
      "claude-opus-4-1": {
        rates: { input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75, cacheWrite: 18.75 },
        tiers: {
          "batch": { rates: { input: 7.5, cacheWrite5m: 9.375, cacheWrite1h: 15, cacheRead: 0.75, output: 37.5, cacheWrite: 9.375 } },
        },
      },
      "claude-opus-4": {
        rates: { input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75, cacheWrite: 18.75 },
        tiers: {
          "batch": { rates: { input: 7.5, cacheWrite5m: 9.375, cacheWrite1h: 15, cacheRead: 0.75, output: 37.5, cacheWrite: 9.375 } },
        },
      },
      "claude-sonnet-5-5": {
        rates: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10, cacheWrite: 2.5 },
        tiers: {
          "batch": { rates: { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.05, output: 5, cacheWrite: 1.25 } },
        },
      },
      "claude-sonnet-5": {
        rates: { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10, cacheWrite: 2.5 },
        tiers: {
          "batch": { rates: { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5, cacheWrite: 1.25 } },
        },
      },
      "claude-sonnet-4-6": {
        rates: { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15, cacheWrite: 3.75 },
        tiers: {
          "batch": { rates: { input: 1.5, cacheWrite5m: 1.875, cacheWrite1h: 3, cacheRead: 0.15, output: 7.5, cacheWrite: 1.875 } },
        },
      },
      "claude-sonnet-4-5": {
        rates: { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15, cacheWrite: 3.75 },
        tiers: {
          "batch": { rates: { input: 1.5, cacheWrite5m: 1.875, cacheWrite1h: 3, cacheRead: 0.15, output: 7.5, cacheWrite: 1.875 } },
        },
      },
      "claude-sonnet-4": {
        rates: { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15, cacheWrite: 3.75 },
        tiers: {
          "batch": { rates: { input: 1.5, cacheWrite5m: 1.875, cacheWrite1h: 3, cacheRead: 0.15, output: 7.5, cacheWrite: 1.875 } },
        },
      },
      "claude-haiku-5-5": {
        rates: { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5, cacheWrite: 0.125 },
        longContext: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5, cacheWrite: 0.625 },
        threshold: 100000,
        tiers: {
          "batch": {
            rates: { input: 0.05, cacheWrite5m: 0.0625, cacheWrite1h: 0.1, cacheRead: 0.005, output: 0.25, cacheWrite: 0.0625 },
            longContext: { input: 0.25, cacheWrite5m: 0.3125, cacheWrite1h: 0.5, cacheRead: 0.025, output: 1.25, cacheWrite: 0.3125 },
          },
        },
      },
      "claude-haiku-4-5": {
        rates: { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5, cacheWrite: 1.25 },
        tiers: {
          "batch": { rates: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5, cacheWrite: 0.625 } },
        },
      },
      "claude-haiku-3-5": {
        rates: { input: 0.8, cacheWrite5m: 1, cacheWrite1h: 1.6, cacheRead: 0.08, output: 4, cacheWrite: 1 },
        checkedAt: "2026-10-05T11:15:18.000Z",
      },
    },
  },
  deepseek: {
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "deepseek-flash": {
        rates: { cacheRead: 0.006, input: 0.3, output: 1.2, cacheWrite: 0.3 },
        timePolicy: "deepseek",
        tiers: {
          "off-peak": { rates: { cacheRead: 0.003, input: 0.15, output: 0.6, cacheWrite: 0.15 } },
        },
      },
      "deepseek-v4-pro": {
        rates: { cacheRead: 0.044, input: 1.32, output: 3.96, cacheWrite: 1.32 },
        timePolicy: "deepseek",
        tiers: {
          "off-peak": { rates: { cacheRead: 0.022, input: 0.66, output: 1.98, cacheWrite: 0.66 } },
        },
      },
      "deepseek-v4-flash": {
        rates: { cacheRead: 0.006, input: 0.3, output: 1.2, cacheWrite: 0.3 },
        timePolicy: "deepseek",
        tiers: {
          "off-peak": { rates: { cacheRead: 0.003, input: 0.15, output: 0.6, cacheWrite: 0.15 } },
        },
      },
      "deepseek-v4-flash-vision-exp": {
        rates: { cacheRead: 0.006, input: 0.3, output: 1.2, cacheWrite: 0.3 },
        timePolicy: "deepseek",
        tiers: {
          "off-peak": { rates: { cacheRead: 0.003, input: 0.15, output: 0.6, cacheWrite: 0.15 } },
        },
      },
    },
  },
  mimo: {
    source: "https://mimo.mi.com/static/docs/price/pay-as-you-go.md",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "mimo-v2.6-pro": {
        rates: { cacheRead: 0.0036, input: 0.435, output: 0.87, cacheWrite: 0 },
        tiers: {
          "batch": { rates: { cacheRead: 0.0018, input: 0.2175, output: 0.435, cacheWrite: 0 } },
        },
      },
      "mimo-v2.6-flash": {
        rates: { cacheRead: 0.0028, input: 0.14, output: 0.28, cacheWrite: 0 },
        tiers: {
          "batch": { rates: { cacheRead: 0.0014, input: 0.07, output: 0.14, cacheWrite: 0 } },
        },
      },
      "mimo-v2.6-pro-ultraspeed": { rates: { cacheRead: 0.036, input: 4.35, output: 8.7, cacheWrite: 0 } },
      "mimo-v2.5-pro": { rates: { cacheRead: 0.0036, input: 0.435, output: 0.87, cacheWrite: 0 }, checkedAt: "2026-10-07T03:39:00Z" },
      "mimo-v2.5": { rates: { cacheRead: 0.0028, input: 0.14, output: 0.28, cacheWrite: 0 }, checkedAt: "2026-10-07T03:39:00Z" },
    },
  },
  zai: {
    source: "https://docs.z.ai/guides/overview/pricing",
    checkedAt: "2026-11-19T11:33:09.683Z",
    models: {
      "glm-5.3": { rates: { input: 1.4, cacheRead: 0.26, output: 4.4, cacheWrite: 1.4 } },
      "glm-5.3-flash": { rates: { input: 0.15, cacheRead: 0.03, output: 0.5, cacheWrite: 0.15 } },
      "glm-5.3-flashx": { rates: { input: 0.37, cacheRead: 0.075, output: 1.25, cacheWrite: 0.37 } },
      "glm-5.3-flashx-legal": { rates: { input: 0.37, cacheRead: 0.075, output: 1.25, cacheWrite: 0.37 } },
      "glm-5.2": { rates: { input: 1.4, cacheRead: 0.26, output: 4.4, cacheWrite: 1.4 } },
      "glm-5.1": { rates: { input: 1.4, cacheRead: 0.26, output: 4.4, cacheWrite: 1.4 } },
      "glm-5": { rates: { input: 1, cacheRead: 0.2, output: 3.2, cacheWrite: 1 } },
      "glm-4.7": { rates: { input: 0.6, cacheRead: 0.11, output: 2.2, cacheWrite: 0.6 } },
      "glm-4.6": { rates: { input: 0.6, cacheRead: 0.11, output: 2.2, cacheWrite: 0.6 } },
      "glm-4.7-flashx": { rates: { input: 0.07, cacheRead: 0.01, output: 0.4, cacheWrite: 0.07 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5": { rates: { input: 0.6, cacheRead: 0.11, output: 2.2, cacheWrite: 0.6 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5-x": { rates: { input: 2.2, cacheRead: 0.45, output: 8.9, cacheWrite: 2.2 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5-air": { rates: { input: 0.2, cacheRead: 0.03, output: 1.1, cacheWrite: 0.2 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5-airx": { rates: { input: 1.1, cacheRead: 0.22, output: 4.5, cacheWrite: 1.1 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4-32b-0414-128k": { rates: { input: 0.1, output: 0.1, cacheWrite: 0.1 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.7-flash": { rates: { input: 0, cacheRead: 0, output: 0, cacheWrite: 0 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5-flash": { rates: { input: 0, cacheRead: 0, output: 0, cacheWrite: 0 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.6v": { rates: { input: 0.3, cacheRead: 0.05, output: 0.9, cacheWrite: 0.3 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-ocr": { rates: { input: 0.03, output: 0.03, cacheWrite: 0.03 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.6v-flashx": { rates: { input: 0.04, cacheRead: 0.004, output: 0.4, cacheWrite: 0.04 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.5v": { rates: { input: 0.6, cacheRead: 0.11, output: 1.8, cacheWrite: 0.6 }, checkedAt: "2026-10-07T03:39:00Z" },
      "glm-4.6v-flash": { rates: { input: 0, cacheRead: 0, output: 0, cacheWrite: 0 }, checkedAt: "2026-10-07T03:39:00Z" },
    },
  },
};
