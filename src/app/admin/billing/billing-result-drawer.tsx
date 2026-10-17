"use client";

import { useEffect, useRef, useState } from "react";
import { StatusChip } from "@/app/components/portal-ui";
import { money, stamp, type BillingVisitRow } from "./billing-shared";

/** Side drawer on wide screens, bottom sheet on phones (see .billing-drawer in billing.css). */
export default function BillingResultDrawer({ visit, clientName, onClose }: { visit: BillingVisitRow; clientName: string; onClose: () => void }) {
  const result = visit.result, closeRef = useRef<HTMLButtonElement>(null), [copied, setCopied] = useState("");
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  if (!result) return null;
  const error = result.status === "ERROR";
  const title = error ? "Visit could not be billed" : "Visit billed successfully";
  const rows: [string, string][] = [
    ["Client", clientName], ["Visit", `${stamp(visit.startAt)} · ${visit.waldahServiceType ?? visit.serviceCode ?? "No service type"}`], ["Caregiver", visit.caregiverName ?? "Not recorded"],
    ...(error
      ? [["Hours", visit.hours === null ? "—" : visit.hours.toFixed(2)], ["Attempted", result.attemptedCents === null ? "—" : money(result.attemptedCents)]] as [string, string][]
      : [["Hours × rate", visit.hours === null || visit.rateCents === null ? "—" : `${visit.hours.toFixed(2)} h × ${money(visit.rateCents)}`], ["Amount billed", money(result.amountCents)]] as [string, string][]),
    ["When", stamp(result.at)], ["Started by", result.startedBy ?? "—"], [error ? "Reference" : "Confirmation", result.reference ?? "—"]
  ];
  async function copy() {
    const text = [title, error ? `${result!.status === "ERROR" ? result!.code : ""}: ${result!.status === "ERROR" ? result!.message : ""}` : "", ...rows.map(([label, value]) => `${label}: ${value}`)].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied("Copied."); } catch { setCopied("Copy is not available in this browser."); }
  }
  return (
    <div className="billing-drawer-layer">
      <div className="billing-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="billing-drawer" role="dialog" aria-modal="true" aria-labelledby="billing-drawer-title">
        <header className="billing-drawer-head">
          <div><StatusChip tone={error ? "danger" : "good"}>{error ? "Billing error" : "Billed"}</StatusChip><h2 id="billing-drawer-title">{title}</h2></div>
          <button ref={closeRef} type="button" className="billing-drawer-x" onClick={onClose} aria-label="Close details">×</button>
        </header>
        <div className="billing-drawer-body">
          {error
            ? <div className="billing-callout danger"><b>{result.code}</b> · {result.message}</div>
            : <><div><span className="billing-muted">Amount that went through</span><p className="billing-drawer-amount">{money(result.amountCents)}</p></div><div className="billing-callout good">Accepted {stamp(result.at)}. Nothing further is needed for this visit.</div></>}
          <dl className="billing-drawer-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {error && result.guidance ? <div><b>What to do</b><p>{result.guidance}</p></div> : null}
          <p className="billing-muted" role="status">{copied}</p>
        </div>
        <footer className="billing-drawer-foot">
          {error ? <button type="button" disabled title="Billing retries are not enabled yet">Retry this visit</button> : null}
          <button type="button" className="secondary" onClick={() => void copy()}>Copy details</button>
          <button type="button" className="secondary billing-drawer-close" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </div>
  );
}
