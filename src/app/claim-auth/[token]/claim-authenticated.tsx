"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { InvitationRequestTimeoutError, postInvitationRequest } from "@/lib/invitation-request";

type ClaimState = { kind: "CLAIMING" | "SUCCESS" | "MISMATCH" | "ALREADY_CLAIMED" | "ERROR"; message: string; destination?: string };

export default function ClaimAuthenticated({ token }: { token: string }) {
  const [state, setState] = useState<ClaimState>({ kind: "CLAIMING", message: "Confirming your account…" }), [busy, setBusy] = useState(false), startedToken = useRef<string | null>(null);
  const claim = useCallback(async () => {
    setState({ kind: "CLAIMING", message: "Confirming your account…" });
    try {
      const { ok, body } = await postInvitationRequest("/api/portal/claim", token, { timeoutMs: 10_000 });
      if (ok) return setState({ kind: "SUCCESS", message: "Invitation accepted. Your employee account is ready.", destination: typeof body.destination === "string" ? body.destination : "/" });
      if (body.code === "INVITATION_ACCOUNT_MISMATCH") return setState({ kind: "MISMATCH", message: "This invitation was sent to a different account." });
      if (body.code === "INVITATION_ALREADY_CLAIMED") return setState({ kind: "ALREADY_CLAIMED", message: "This invitation has already been claimed." });
      setState({ kind: "ERROR", message: typeof body.error === "string" ? body.error : "Invitation could not be accepted." });
    } catch (error) {
      setState({ kind: "ERROR", message: error instanceof InvitationRequestTimeoutError ? "The request took too long. Check your connection and try again." : "Invitation could not be accepted. Check your connection and try again." });
    }
  }, [token]);
  useEffect(() => { if (startedToken.current !== token) { startedToken.current = token; void claim(); } }, [claim, token]);
  async function switchAccount() {
    setBusy(true);
    try {
      const { ok, body } = await postInvitationRequest("/api/auth/invitation-switch", token);
      if (!ok || typeof body.logoutUrl !== "string") throw new Error(typeof body.error === "string" ? body.error : "Account switch could not be started.");
      window.location.assign(body.logoutUrl);
    } catch (error) { setState({ kind: "ERROR", message: error instanceof Error ? error.message : "Account switch could not be started." }); setBusy(false); }
  }
  return <main className="portal-shell invitation-shell"><header className="portal-header"><p className="eyebrow">Account invitation</p><h1>Waldah access</h1></header><section className="invitation-card"><p role={state.kind === "ERROR" || state.kind === "MISMATCH" ? "alert" : "status"} aria-live="polite">{state.message}</p><div className="invitation-actions">{state.kind === "MISMATCH" ? <><p>Sign out of the current account, then sign in or create the account that owns this invitation.</p><button disabled={busy} onClick={() => void switchAccount()}>{busy ? "Signing out…" : "Sign out and continue"}</button></> : null}{state.kind === "SUCCESS" && state.destination ? <a className="button-link" href={state.destination}>Open your workspace</a> : null}{state.kind === "ALREADY_CLAIMED" ? <Link className="button-link" href="/">Continue to your account</Link> : null}{state.kind === "ERROR" ? <button type="button" onClick={() => void claim()}>Try again</button> : null}{state.kind === "CLAIMING" ? <button type="button" disabled>Confirming…</button> : null}</div></section></main>;
}
