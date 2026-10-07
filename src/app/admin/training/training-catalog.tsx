"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ActionFeedback, PortalShell, useAsyncAction } from "@/app/components/portal-ui";

type CatalogCourse = { title: string; versions: { id: string; versionNumber: number; status: string }[] };
type Employee = { id: string; firstName: string; lastName: string; employeeNumber: string | null; employmentStatus: string };

export default function TrainingCatalog({ organizationId }: { organizationId: string }) {
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const loading = useAsyncAction();
  const assigning = useAsyncAction();
  const headers = { "content-type": "application/json" };

  async function json(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { ...headers, ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Training catalog request failed");
    return body;
  }

  async function load() {
    await loading.execute(async () => {
      const [catalog, workforce] = await Promise.all([
        json(`/api/organizations/${organizationId}/training/catalog`),
        json(`/api/organizations/${organizationId}/admin/workforce?pageSize=100`),
      ]);
      setCourses(catalog as CatalogCourse[]);
      setEmployees((workforce as { items: Employee[] }).items);
      setEmployeeId(current => current || (workforce as { items: Employee[] }).items[0]?.id || "");
      setLoaded(true);
    }, "Catalog and authorized employee roster loaded.");
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await assigning.execute(async () => {
      await json(`/api/organizations/${organizationId}/training/assignments`, {
        method: "POST",
        body: JSON.stringify({ employeeId, courseVersionId: data.get("courseVersionId") }),
      });
    }, "Training assigned to the selected employee using the published version.");
  }

  // The server validates and fixes organization context for this mounted catalog.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [organizationId]);
  const versions = useMemo(() => courses.flatMap(course => course.versions.filter(version => ["PUBLISHED", "ACTIVE"].includes(version.status)).map(version => ({ ...version, title: course.title }))), [courses]);

  return <PortalShell organizationId={organizationId} current="Training catalog"><main className="admin-shell" aria-busy={loading.state === "pending" || assigning.state === "pending"}>
    <header><p className="eyebrow">Version-governed learning</p><h1>Training catalog</h1><p className="lede">Review authorized published courses and assign an exact version to an employee.</p></header>
    <div className="section-heading"><div><h2>Published courses</h2><p>Loading the catalog is read-only and does not change organization or training state.</p></div><button type="button" onClick={() => void load()} disabled={loading.state === "pending"}>{loading.state === "pending" ? "Loading catalog…" : "Refresh catalog"}</button></div>
    <ActionFeedback state={loading.state} message={loading.message} />
    {loaded ? <>
      <section className="record-panel"><h2>Assign training</h2><form className="inline-form" onSubmit={assign}>
        <label>Employee<select value={employeeId} onChange={event => setEmployeeId(event.target.value)} required disabled={assigning.state === "pending"}><option value="">Select employee…</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}{employee.employeeNumber ? ` · ${employee.employeeNumber}` : ""} · {employee.employmentStatus.toLowerCase()}</option>)}</select></label>
        <label>Published course version<select name="courseVersionId" required disabled={assigning.state === "pending"}><option value="">Select course…</option>{versions.map(version => <option value={version.id} key={version.id}>{version.title} · v{version.versionNumber}</option>)}</select></label>
        <button disabled={assigning.state === "pending" || !employeeId}>{assigning.state === "pending" ? "Assigning…" : "Assign training"}</button>
      </form><ActionFeedback state={assigning.state} message={assigning.message} /></section>
      <section><h2>Catalog</h2>{courses.length ? courses.map(course => <article key={course.title}><h3>{course.title}</h3>{course.versions.map(version => <p key={version.id}>Version {version.versionNumber} · {version.status.toLowerCase()}</p>)}</article>) : <div className="empty-state">No authorized courses are currently available.</div>}</section>
    </> : loading.state === "error" ? <div className="empty-state">The authorized catalog could not be loaded.</div> : null}
  </main></PortalShell>;
}
