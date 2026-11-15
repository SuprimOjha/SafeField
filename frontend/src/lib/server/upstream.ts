// Shared upstream JSON fetch helper with timeout, bounded retries and honest
// error propagation. Every provider module in this folder uses it so failures
// surface as typed exceptions that callers turn into UNAVAILABLE badges —
// never into substituted or guessed values.

export class UpstreamError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export type QueryParams = Record<string, string | number | (string | number)[]>;

export function buildUrl(base: string, params: QueryParams = {}): string {
  const url = new URL(base);
  for (const [key, raw] of Object.entries(params)) {
    if (Array.isArray(raw)) {
      for (const item of raw) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(raw));
    }
  }
  return url.toString();
}

async function fetchJsonOnce<T>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new UpstreamError(
      `Upstream request failed for ${new URL(url).host}${new URL(url).pathname}: HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function fetchJson<T>(
  url: string,
  options: {
    params?: QueryParams;
    timeoutMs?: number;
    retries?: number;
    method?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const { params, timeoutMs = 15_000, retries = 1, method = "GET", body } = options;
  const target = buildUrl(url, params);
  const init: RequestInit | undefined =
    body === undefined
      ? method === "GET"
        ? undefined
        : { method }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };

  let lastError: unknown;
  for (let attempt = 0; attempt <= Math.max(0, retries); attempt++) {
    try {
      return await fetchJsonOnce<T>(target, init, timeoutMs);
    } catch (error) {
      lastError = error;
      // 429 responses from upstream are not retried immediately; callers keep
      // their own negative-cache/cooldown behaviour for rate limits.
      if (error instanceof UpstreamError && error.status !== null && error.status < 500) throw error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new UpstreamError(String(lastError));
}
