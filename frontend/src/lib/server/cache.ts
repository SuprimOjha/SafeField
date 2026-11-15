// Small in-memory TTL cache shared by the field-assessment route handlers.
// It reduces repeat upstream load (NASA POWER, SoilGrids, Open-Meteo) while a
// serverless instance stays warm. Entries are per-instance only; every caller
// must tolerate a cold cache.

type CacheEntry = { value: unknown; expiresAt: number };

const MAX_ENTRIES = 512;
const store = new Map<string, CacheEntry>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  if (ttlSeconds <= 0) return;
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      .slice(0, Math.ceil(MAX_ENTRIES / 4));
    for (const [keyToDelete] of oldest) store.delete(keyToDelete);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
