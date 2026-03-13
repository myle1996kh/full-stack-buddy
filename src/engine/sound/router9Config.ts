const env = (typeof import.meta !== 'undefined' ? import.meta.env : {}) as Record<string, string | undefined>;

export type Router9ApiKeySource = 'VITE_NINEROUTER_API_KEY' | 'VITE_ROUTER9_API_KEY' | 'none';

export interface Router9RuntimeConfig {
  baseUrl: string;
  model: string;
  combo: string;
  apiKey: string;
  timeoutMs: number;
  llmEnabled: boolean;
  apiKeySource: Router9ApiKeySource;
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function getRouter9RuntimeConfig(): Router9RuntimeConfig {
  const baseUrl = pickFirstNonEmpty(
    env.VITE_NINEROUTER_BASE_URL,
    env.VITE_ROUTER9_BASE_URL,
    'http://35.185.132.75/v1',
  );

  const model = pickFirstNonEmpty(
    env.VITE_NINEROUTER_MODEL,
    env.VITE_ROUTER9_MODEL,
    'combo:mse',
  );

  const combo = pickFirstNonEmpty(
    env.VITE_NINEROUTER_COMBO,
    env.VITE_ROUTER9_COMBO,
    'mse',
  );

  const timeoutMs = parseNumber(
    pickFirstNonEmpty(env.VITE_NINEROUTER_TIMEOUT_MS, env.VITE_ROUTER9_TIMEOUT_MS),
    12000,
  );

  const llmEnabled = parseBoolean(
    pickFirstNonEmpty(env.VITE_SOUND_COACH_LLM_ENABLED, env.VITE_ROUTER9_LLM_ENABLED),
    true,
  );

  const keyFromNineRouter = env.VITE_NINEROUTER_API_KEY?.trim() ?? '';
  const keyFromRouter9 = env.VITE_ROUTER9_API_KEY?.trim() ?? '';
  const apiKey = keyFromNineRouter || keyFromRouter9 || '';
  const apiKeySource: Router9ApiKeySource = keyFromNineRouter
    ? 'VITE_NINEROUTER_API_KEY'
    : keyFromRouter9
      ? 'VITE_ROUTER9_API_KEY'
      : 'none';

  return {
    baseUrl,
    model,
    combo,
    apiKey,
    timeoutMs,
    llmEnabled,
    apiKeySource,
  };
}
