export const MODEL_PROFILES = {
  "deepseek-flash": {
    json: true,
    vision: true,
    thinking: true,
    verifiedAt: "2026-09-21",
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
  },
  "deepseek-v4-pro": {
    json: true,
    vision: false,
    thinking: true,
    verifiedAt: "2026-09-21",
    source: "https://api-docs.deepseek.com/quick_start/pricing/",
  },
} as const;
export const ADAPTER_VERSION = "deepseek-json-text-v2-2026-09-22";
