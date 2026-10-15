// GET-only AxisCare API client. AxisCare's API also offers write endpoints; this module must never call them.
export const AXISCARE_API_VERSION = "2023-10-01";

export class AxisCareApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "AxisCareApiError"; }
}

export type AxisCareListEnvelope = { results?: Record<string, unknown> & { nextPage?: string | null }; errors?: unknown[] | null };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type AxisCareClientOptions = { baseUrl: string; token: string; fetcher?: Fetcher; sleep?: (ms: number) => Promise<void>; maxRetries?: number };

export class AxisCareClient {
  private readonly base: URL;
  private readonly fetcher: Fetcher;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  constructor(private readonly options: AxisCareClientOptions) {
    this.base = new URL(options.baseUrl);
    if (this.base.protocol !== "https:" || this.base.port || !/^[a-z0-9-]+\.axiscare\.com$/i.test(this.base.hostname) || this.base.pathname !== "/") throw new AxisCareApiError(0, "AxisCare base URL is invalid");
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 4;
  }

  /** Only same-host https URLs are followed, so a hostile nextPage value can never send the token elsewhere. */
  private resolve(pathOrUrl: string, query?: Record<string, string | number | undefined>) {
    const url = new URL(pathOrUrl, this.base);
    if (url.origin !== this.base.origin) throw new AxisCareApiError(0, "Refusing to call a different host than the configured AxisCare site");
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    return url;
  }

  async get<T = unknown>(pathOrUrl: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.resolve(pathOrUrl, query);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url.toString(), { method: "GET", headers: { Authorization: `Bearer ${this.options.token}`, "X-AxisCare-Api-Version": AXISCARE_API_VERSION, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      } catch {
        if (attempt >= this.maxRetries) throw new AxisCareApiError(0, "AxisCare request was unavailable");
        await this.sleep(Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
      if (response.ok) {
        const body = await response.json() as T & { errors?: unknown[] | null };
        if (Array.isArray(body?.errors) && body.errors.length) throw new AxisCareApiError(response.status, "AxisCare returned an unsuccessful response");
        return body;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.maxRetries) throw new AxisCareApiError(response.status, `AxisCare request failed with status ${response.status}`);
      const retryHeader = response.headers.get("retry-after"), retrySeconds = Number(retryHeader), retryDate = retryHeader ? Date.parse(retryHeader) : Number.NaN;
      const retryMs = Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 500 * 2 ** attempt;
      await this.sleep(Math.min(60_000, retryMs));
    }
  }

  /** Follows results.nextPage until exhausted. `listKey` is the array name under `results`; null uses the first array found. */
  async *list(path: string, listKey: string | null, query?: Record<string, string | number | undefined>): AsyncGenerator<Record<string, unknown>[]> {
    let next: string | null = path;
    let first = true;
    const seen = new Set<string>();
    while (next) {
      const resolved = this.resolve(next, first ? query : undefined).toString();
      if (seen.has(resolved) || seen.size >= 10_000) throw new AxisCareApiError(0, "AxisCare pagination did not terminate safely");
      seen.add(resolved);
      const body: AxisCareListEnvelope = await this.get<AxisCareListEnvelope>(next, first ? query : undefined);
      first = false;
      const items = listKey ? body.results?.[listKey] : Object.values(body.results ?? {}).find(Array.isArray);
      if (Array.isArray(items) && items.length) yield items as Record<string, unknown>[];
      next = typeof body.results?.nextPage === "string" && body.results.nextPage ? body.results.nextPage : null;
    }
  }
}
