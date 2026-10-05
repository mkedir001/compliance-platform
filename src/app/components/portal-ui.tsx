"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";

type NavigationItem = { label: string; href: string; group?: string; current?: boolean };

export function PortalShell({ organizationId, current, children, navigation }: { organizationId: string; current: string; children: ReactNode; navigation?: NavigationItem[] }) {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  const items = navigation ?? [
    { label: "Home", href: `/admin/home${query}`, group: "Workspace" },
    { label: "Employees", href: `/admin/employees${query}`, group: "People" },
    { label: "Clients", href: `/admin/clients${query}`, group: "People" },
    { label: "Evidence review", href: `/admin/evidence-operations${query}`, group: "Review queues" },
    { label: "Competency assessments", href: `/admin/competencies${query}`, group: "Review queues" },
    { label: "Signatures", href: `/admin/clients${query ? `${query}&` : "?"}view=Signatures`, group: "Review queues" },
    { label: "Policies", href: `/admin/policy-operations${query}`, group: "Library" },
    { label: "Training catalog", href: `/admin/training${query}`, group: "Library" },
    { label: "Reports and audit", href: `/admin/reporting${query}`, group: "Records" },
    { label: "Settings", href: `/admin/setup${query}`, group: "Administration" },
  ];
  let lastGroup = "";
  return (
    <div className="portal-app">
      <aside className="portal-sidebar">
        <a className="portal-brand" href={`/admin/home${query}`} aria-label="Compliance Platform home"><span aria-hidden="true">W</span><strong>Compliance Platform</strong></a>
        <p className="portal-org">Organization workspace</p>
        <nav aria-label="Organization navigation">
          {items.map((item) => {
            const heading = item.group && item.group !== lastGroup ? item.group : null;
            if (item.group) lastGroup = item.group;
            return <div key={item.href + item.label}>{heading ? <p className="portal-nav-group">{heading}</p> : null}<a className={item.current || item.label === current ? "current" : ""} href={item.href} aria-current={item.current || item.label === current ? "page" : undefined}>{item.label}</a></div>;
          })}
        </nav>
        <p className="portal-sidebar-note">Operational status is derived from authoritative records and is not a legal certification.</p>
      </aside>
      <div className="portal-workspace">
        <header className="portal-topbar"><span>{current}</span><Link href="/">Switch workspace</Link></header>
        {children}
      </div>
    </div>
  );
}

export type AsyncState = "idle" | "pending" | "success" | "error";

export function useAsyncAction() {
  const [state, setState] = useState<AsyncState>("idle");
  const [message, setMessage] = useState("");
  async function execute(work: () => Promise<unknown>, success: string) {
    if (state === "pending") return false;
    setState("pending"); setMessage("");
    try { await work(); setState("success"); setMessage(success); return true; }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "The action could not be completed."); return false; }
  }
  return { state, message, execute, reset: () => { setState("idle"); setMessage(""); } };
}

export function ActionFeedback({ state, message }: { state: AsyncState; message: string }) {
  if (!message && state !== "pending") return null;
  return <p className={`action-feedback ${state}`} role={state === "error" ? "alert" : "status"} aria-live="polite">{state === "pending" ? <span className="spinner" aria-hidden="true" /> : null}{message || "Working…"}</p>;
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="portal-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-heading"><h2 id="drawer-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close drawer">×</button></div>{children}</section></div>;
}

export function StatusChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <span className={`status-chip ${tone}`}>{children}</span>;
}
