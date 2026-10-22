import { describe, expect, it, vi } from "vitest";
import { InvitationRequestTimeoutError, postInvitationRequest } from "@/lib/invitation-request";

describe("mobile invitation requests", () => {
  it("posts the token without putting it in the URL and returns JSON", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ state: "VALID" }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await postInvitationRequest("/api/public/portal/claim/status", "t".repeat(43), { fetcher: fetcher as typeof fetch });
    expect(result).toMatchObject({ ok: true, status: 200, body: { state: "VALID" } });
    expect(fetcher).toHaveBeenCalledWith("/api/public/portal/claim/status", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "t".repeat(43) }), cache: "no-store", credentials: "same-origin" }));
  });

  it("aborts a request that never settles so the UI can offer retry", async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    await expect(postInvitationRequest("/api/public/portal/claim/status", "t".repeat(43), { timeoutMs: 5, fetcher: fetcher as typeof fetch })).rejects.toBeInstanceOf(InvitationRequestTimeoutError);
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("surfaces a network failure instead of leaving a pending state", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("Network unavailable"); });
    await expect(postInvitationRequest("/api/public/portal/claim/status", "t".repeat(43), { fetcher: fetcher as typeof fetch })).rejects.toThrow("Network unavailable");
  });
});
