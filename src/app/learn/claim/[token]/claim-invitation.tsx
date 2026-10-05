"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function ClaimInvitation({ token }: { token: string }) {
  const [state, setState] = useState<{kind:string;message:string}>({ kind: "CHECKING", message: "Checking your invitation…" });
  useEffect(() => {
    fetch("/api/public/portal/claim/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async response => { const body = await response.json(); const messages:Record<string,string>={VALID:"Your invitation is ready. Continue to sign in or create your employee account.",CLAIMED:"This invitation has already been claimed.",EXPIRED:"This invitation has expired. Ask your organization administrator to reissue it.",REVOKED:"This invitation is no longer active. Contact your organization administrator.",SUPERSEDED:"This invitation was replaced. Use the most recent invitation from your organization.",INVALID:"This invitation is invalid or unavailable."};setState({kind:body.state??"INVALID",message:messages[body.state]??messages.INVALID}); })
      .catch(() => setState({ kind: "INVALID", message: "This invitation is invalid or unavailable." }));
  }, [token]);
  return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Employee account invitation</p><h1>Compliance Platform access</h1></header><section><p role="status">{state.message}</p>{state.kind === "VALID" ? <a className="button-link" href={`/claim-auth/${encodeURIComponent(token)}`}>Continue securely</a> : null}{state.kind === "CLAIMED" ? <Link className="button-link" href="/">Continue to your account</Link> : null}</section></main>;
}
