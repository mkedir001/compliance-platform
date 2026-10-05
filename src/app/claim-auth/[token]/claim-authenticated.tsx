"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type ClaimState = { kind: "CLAIMING" | "SUCCESS" | "MISMATCH" | "ALREADY_CLAIMED" | "ERROR"; message: string; destination?: string };

export default function ClaimAuthenticated({ token }: { token: string }) {
  const [state, setState] = useState<ClaimState>({ kind: "CLAIMING", message: "Confirming your employee account…" }), [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/portal/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async response => { const body = await response.json(); if (response.ok) return setState({ kind: "SUCCESS", message: "Invitation accepted. Your employee account is ready.", destination: body.destination }); if (body.code === "INVITATION_ACCOUNT_MISMATCH") return setState({ kind: "MISMATCH", message: "This invitation was sent to a different account." }); if (body.code === "INVITATION_ALREADY_CLAIMED") return setState({ kind: "ALREADY_CLAIMED", message: "This invitation has already been claimed." }); setState({ kind: "ERROR", message: body.error ?? "Invitation could not be accepted." }); })
      .catch(() => setState({ kind: "ERROR", message: "Invitation could not be accepted." }));
  }, [token]);
  async function switchAccount() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/invitation-switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }), body = await response.json();
      if (!response.ok || !body.logoutUrl) throw new Error(body.error ?? "Account switch could not be started.");
      window.location.assign(body.logoutUrl);
    } catch (error) { setState({ kind: "ERROR", message: error instanceof Error ? error.message : "Account switch could not be started." }); setBusy(false); }
  }
  return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Employee account invitation</p><h1>Compliance Platform access</h1></header><section><p role="status">{state.message}</p>{state.kind === "MISMATCH" ? <><p>Sign out of the current account, then sign in or create the account that owns this invitation.</p><button disabled={busy} onClick={() => void switchAccount()}>{busy ? "Signing out…" : "Sign out and continue"}</button></> : null}{state.kind === "SUCCESS" && state.destination ? <a className="button-link" href={state.destination}>Open employee self-service</a> : null}{state.kind === "ALREADY_CLAIMED" ? <Link className="button-link" href="/">Continue to your account</Link> : null}</section></main>;
}
