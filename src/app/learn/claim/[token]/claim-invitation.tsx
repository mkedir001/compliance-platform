"use client";
import { useState } from "react";
import Link from "next/link";
import { postInvitationRequest } from "@/lib/invitation-request";

type InvitationState = "VALID" | "CLAIMED" | "EXPIRED" | "REVOKED" | "SUPERSEDED" | "INVALID" | "UNAVAILABLE" | "CHECKING";
const messages: Record<InvitationState, string> = {
  VALID: "Your invitation is ready. Continue to sign in or create your employee account.",
  CLAIMED: "This invitation has already been claimed.",
  EXPIRED: "This invitation has expired. Ask your organization administrator to reissue it.",
  REVOKED: "This invitation is no longer active. Contact your organization administrator.",
  SUPERSEDED: "This invitation was replaced. Use the most recent invitation from your organization.",
  INVALID: "This invitation is invalid or unavailable.",
  UNAVAILABLE: "We could not check this invitation. Check your connection and try again.",
  CHECKING: "Checking your invitation…",
};
const states = new Set<InvitationState>(Object.keys(messages) as InvitationState[]);

export default function ClaimInvitation({ token, initialState }: { token: string; initialState: Exclude<InvitationState, "CHECKING"> }) {
  const [kind, setKind] = useState<InvitationState>(initialState);
  async function retry() {
    setKind("CHECKING");
    try {
      const { body } = await postInvitationRequest("/api/public/portal/claim/status", token);
      setKind(typeof body.state === "string" && states.has(body.state as InvitationState) ? body.state as InvitationState : "INVALID");
    } catch { setKind("UNAVAILABLE"); }
  }
  const failed = ["INVALID", "EXPIRED", "REVOKED", "SUPERSEDED", "UNAVAILABLE"].includes(kind);
  return <main className="portal-shell invitation-shell"><header className="portal-header"><p className="eyebrow">Account invitation</p><h1>Waldah access</h1></header><section className="invitation-card"><p role={failed ? "alert" : "status"} aria-live="polite">{messages[kind]}</p><div className="invitation-actions">{kind === "VALID" ? <a className="button-link" href={`/claim-auth/${encodeURIComponent(token)}`}>Continue securely</a> : null}{kind === "CLAIMED" ? <Link className="button-link" href="/">Continue to your account</Link> : null}{kind === "UNAVAILABLE" ? <button type="button" onClick={() => void retry()}>Try again</button> : null}{kind === "CHECKING" ? <button type="button" disabled>Checking…</button> : null}</div></section></main>;
}
