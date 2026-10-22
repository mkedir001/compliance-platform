export class InvitationRequestTimeoutError extends Error {
  constructor() { super("The invitation request timed out."); this.name = "InvitationRequestTimeoutError"; }
}

type FetchLike = typeof fetch;

export async function postInvitationRequest(url: string, token: string, options: { timeoutMs?: number; fetcher?: FetchLike } = {}) {
  const controller = new AbortController(), timeoutMs = options.timeoutMs ?? 8_000, fetcher = options.fetcher ?? fetch;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { reject(new InvitationRequestTimeoutError()); controller.abort(); }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store", credentials: "same-origin", signal: controller.signal }),
      deadline,
    ]);
    const body = await response.json() as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
