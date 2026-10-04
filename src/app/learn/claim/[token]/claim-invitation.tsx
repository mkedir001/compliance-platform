"use client";
import { useEffect, useState } from "react";

export default function ClaimInvitation({ token }: { token: string }) {
  const [state, setState] = useState("Accepting your invitation…");
  useEffect(() => {
    fetch("/api/portal/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Invitation could not be accepted"); setState("Invitation accepted. You can now open employee self-service."); })
      .catch(error => setState(error instanceof Error ? error.message : "Invitation could not be accepted"));
  }, [token]);
  return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Employee account invitation</p><h1>Compliance Platform access</h1></header><section><p role="status">{state}</p>{state.startsWith("Invitation accepted") ? <a className="button-link" href="/learn">Open employee self-service</a> : null}</section></main>;
}
