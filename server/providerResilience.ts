export type ProviderRequestError = Error & { status?: number };

type CacheEntry<T> = { value: T; savedAt: number };
type BackoffState = { failures: number; nextAttemptAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const backoff = new Map<string, BackoffState>();
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

export function isRateLimitError(error: unknown) {
  return Number((error as ProviderRequestError)?.status) === 429 || /\b429\b|rate.?limit|too many requests/i.test(error instanceof Error ? error.message : String(error));
}

export function cacheProviderValue<T>(key: string, value: T, savedAt = Date.now()) {
  cache.set(key, { value, savedAt });
}

export function getCachedProviderValue<T>(key: string, maxAgeMs: number, now = Date.now()) {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || now - entry.savedAt > maxAgeMs) return null;
  return { value: entry.value, savedAt: entry.savedAt, ageMs: Math.max(0, now - entry.savedAt) };
}

export function clearProviderResilienceState() {
  cache.clear();
  backoff.clear();
}

export async function requestWithBackoff<T>(key: string, request: () => Promise<T>, maxAttempts = 3) {
  const existing = backoff.get(key);
  if (existing && existing.nextAttemptAt > Date.now()) throw new Error(`Provider backoff active for ${key}; retry after ${Math.ceil((existing.nextAttemptAt - Date.now()) / 1000)}s`);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]));
    try {
      const result = await request();
      backoff.delete(key);
      return result;
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxAttempts - 1) break;
    }
  }
  if (isRateLimitError(lastError)) {
    const failures = (backoff.get(key)?.failures ?? 0) + 1;
    const delay = RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
    backoff.set(key, { failures, nextAttemptAt: Date.now() + delay });
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function backoffDelaysForTest() { return [...RETRY_DELAYS_MS]; }
