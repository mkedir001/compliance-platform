"use client";

import { FormEvent, useEffect, useState } from "react";
import { PortalShell } from "@/app/components/portal-ui";

type Assessment = {
  id: string;
  status: string;
  result: string | null;
  employee: { firstName: string; lastName: string };
  competencyDefinition: { name: string; method: string };
  skillChecklistVersion: { versionNumber: number; items: { id: string; description: string; required: boolean; criticalFailure: boolean }[] } | null;
  items: { skillChecklistItemId: string; result: string }[];
};

export default function Competencies({ organizationId }: { organizationId: string }) {
  const [items, setItems] = useState<Assessment[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { "content-type": "application/json" };

  async function request(init?: RequestInit) {
    const response = await fetch(`/api/organizations/${organizationId}/competencies/assessments`, { ...init, headers });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Competency operation failed");
    return body;
  }

  async function load() {
    setBusy(true);
    try {
      setItems((await request()).items);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load assessments");
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await request({
        method: "POST",
        body: JSON.stringify({
          employeeId: data.get("employeeId"),
          competencyDefinitionId: data.get("competencyDefinitionId"),
          skillChecklistVersionId: data.get("skillChecklistVersionId") || undefined,
          complianceInstanceId: data.get("complianceInstanceId") || undefined,
        }),
      });
      form.reset();
      await load();
      setMessage("Structured competency assessment started. This does not establish competency until finalized from checklist evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assessment could not be created");
    } finally {
      setBusy(false);
    }
  }

  async function finalize(event: FormEvent<HTMLFormElement>, assessment: Assessment) {
    event.preventDefault();
    if (!window.confirm("Finalize this structured assessment? Finalized evidence is immutable and corrections require the controlled void/replacement workflow.")) return;
    const data = new FormData(event.currentTarget);
    const rows = assessment.skillChecklistVersion?.items ?? [];
    setBusy(true);
    try {
      await request({
        method: "PATCH",
        body: JSON.stringify({
          id: assessment.id,
          items: rows.map(item => ({ skillChecklistItemId: item.id, result: data.get(item.id), notes: data.get(`${item.id}-notes`) || undefined })),
          notes: data.get("notes") || undefined,
        }),
      });
      await load();
      setMessage("Assessment finalized from version-bound checklist evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assessment could not be finalized");
    } finally {
      setBusy(false);
    }
  }

  // The server validates and fixes organization context before this view mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [organizationId]);

  return <PortalShell organizationId={organizationId} current="Competency assessments"><main className="admin-shell" aria-busy={busy}>
    <header><p className="eyebrow">Controlled competency evidence</p><h1>Competency assessments</h1><p className="lede">Authorized assessors record observation or other configured methods against an exact checklist version. Employees cannot self-assess.</p></header>
    <p role="status" aria-live="polite">{message}</p>
    <section><details><summary>Start assessment</summary><form className="inline-form" onSubmit={create}><label>Employee ID<input name="employeeId" required /></label><label>Competency definition ID<input name="competencyDefinitionId" required /></label><label>Active checklist version ID<input name="skillChecklistVersionId" /></label><label>Mapped compliance instance ID<input name="complianceInstanceId" /></label><button disabled={busy}>Start structured assessment</button></form></details>
      {items.length ? items.map(item => <article key={item.id}><p className="eyebrow">{item.competencyDefinition.method.toLowerCase().replaceAll("_", " ")} · {item.status.toLowerCase().replaceAll("_", " ")}</p><h2>{item.competencyDefinition.name}</h2><p>{item.employee.firstName} {item.employee.lastName} · {item.result ? item.result.toLowerCase().replaceAll("_", " ") : "competency not yet established"}</p>{item.status === "IN_PROGRESS" && item.skillChecklistVersion ? <form onSubmit={event => finalize(event, item)}><p>Checklist version {item.skillChecklistVersion.versionNumber}</p>{item.skillChecklistVersion.items.map(check => <fieldset key={check.id}><legend>{check.description}{check.required ? " (required)" : ""}{check.criticalFailure ? " (critical)" : ""}</legend><label>Result<select name={check.id} required defaultValue="NOT_OBSERVED"><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="NOT_OBSERVED">Not observed</option><option value="NOT_APPLICABLE">Not applicable</option></select></label><label>Evidence notes<input name={`${check.id}-notes`} /></label></fieldset>)}<label>Assessment notes<textarea name="notes" /></label><button disabled={busy}>Finalize assessment</button></form> : null}</article>) : <div className="empty-state">No competency assessments in this authorized view.</div>}
    </section>
  </main></PortalShell>;
}
