"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useShowTestData } from "@/app/components/test-data-preference";
import {
  ActionFeedback,
  StatusChip,
  useAsyncAction,
} from "@/app/components/portal-ui";

type Candidate = {
  id: string;
  legalFirstName?: string;
  legalLastName?: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string | null;
  status?: string;
  employmentStatus?: string;
  updatedAt: string;
  testDataMarkedAt: string | null;
  testDataReason: string | null;
};
type PreviewRow = {
  type: "CLIENT" | "EMPLOYEE";
  id: string;
  identity: string;
  status: string;
  version: string;
  explicitlyMarked: boolean;
  dependencies: Record<string, number>;
  classification: "DELETE_SAFE" | "ARCHIVE_REQUIRED" | "BLOCKED";
  reason: string;
};
type Preview = { previewId: string; expiresAt: string; records: PreviewRow[] };
const label = (row: Candidate) =>
  row.legalFirstName
    ? `${row.legalFirstName} ${row.legalLastName}`
    : `${row.firstName} ${row.lastName}`;
const tone = (value: string) =>
  value === "DELETE_SAFE"
    ? "danger"
    : value === "ARCHIVE_REQUIRED"
      ? "warning"
      : "neutral";

export default function TestDataCleanupPortal({
  organizationId,
}: {
  organizationId: string;
}) {
  const [type, setType] = useState<"CLIENT" | "EMPLOYEE">("CLIENT"),
    [search, setSearch] = useState(""),
    [rows, setRows] = useState<Candidate[]>([]),
    [selected, setSelected] = useState<Record<string, Candidate>>({}),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [result, setResult] = useState<{
      outcomes: { type: string; id: string; action: string; status: string }[];
    } | null>(null),
    action = useAsyncAction();
  const request = useCallback(
    async (path = "", init?: RequestInit) => {
      const response = await fetch(
          `/api/organizations/${organizationId}/test-data-cleanup${path}`,
          {
            ...init,
            headers: { "content-type": "application/json", ...init?.headers },
          },
        ),
        body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Cleanup operation failed");
      return body;
    },
    [organizationId],
  );
  const load = useCallback(
    async () =>
      setRows(
        await request(`?type=${type}&search=${encodeURIComponent(search)}`),
      ),
    [request, type, search],
  );
  useEffect(() => {
    void load();
  }, [type, load]);
  const selections = useMemo(
    () =>
      Object.entries(selected).map(([key, row]) => ({
        type: key.split(":")[0],
        id: row.id,
        version: new Date(row.updatedAt).toISOString(),
      })),
    [selected],
  );
  function toggle(row: Candidate) {
    const key = `${type}:${row.id}`;
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = row;
      return next;
    });
    setPreview(null);
    setResult(null);
  }
  async function mark(row: Candidate) {
    const reason = window.prompt(
      "Why is this record confirmed to be synthetic test data?",
      row.testDataReason ?? "",
    );
    if (!reason) return;
    const confirmed = window.prompt(
      'Type "MARK AS TEST DATA" to apply the explicit marker.',
    );
    if (confirmed !== "MARK AS TEST DATA") return;
    await action.execute(async () => {
      await request("", {
        method: "POST",
        body: JSON.stringify({
          action: "MARK",
          type,
          id: row.id,
          version: new Date(row.updatedAt).toISOString(),
          reason,
          confirmation: confirmed,
        }),
      });
      await load();
    }, "The selected record is explicitly marked as test data and the action was audited. It is now hidden from normal operational views unless an authorized administrator turns on Show test data.");
  }
  async function previewCleanup(event: FormEvent) {
    event.preventDefault();
    await action.execute(async () => {
      setPreview(
        await request("", {
          method: "POST",
          body: JSON.stringify({ action: "PREVIEW", selections }),
        }),
      );
      setConfirmation("");
      setResult(null);
    }, "Dependency preview created. It expires after 15 minutes and will be revalidated before execution.");
  }
  async function execute() {
    if (!preview) return;
    await action.execute(async () => {
      setResult(
        await request("", {
          method: "POST",
          body: JSON.stringify({
            action: "EXECUTE",
            previewId: preview.previewId,
            confirmation,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      );
      setSelected({});
      setPreview(null);
      await load();
    }, "Cleanup completed. Blocked records were preserved and every completed action was audited.");
  }
  const [showTestData, setShowTestData] = useShowTestData(organizationId);
  return (
    <main className="admin-shell">
      <header className="section-heading">
        <div>
          <p className="eyebrow">Organization settings</p>
          <h1>Test Data Management</h1>
          <p className="lede">
            Select exact synthetic or legacy dummy records, inspect
            dependencies, and archive or delete only when the preview proves it
            is safe.
          </p>
        </div>
      </header>
      <div className="callout warning">
        <strong>Irreversible operation</strong>
        <p>
          Names and dates never determine test data. Explicitly mark verified
          synthetic records or select exact legacy records. Signed and
          compliance evidence is retained.
        </p>
      </div>
      <section className="test-data-visibility-setting">
        <div>
          <h2>Show test data across the platform</h2>
          <p>
            When on, explicitly marked test clients and employees appear in the
            Clients directory and the Employees list, each labeled “Test data”.
            This applies to this browser only and requires organization
            administrator access.
          </p>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            role="switch"
            checked={showTestData}
            onChange={(event) => setShowTestData(event.target.checked)}
          />
          <span>{showTestData ? "Showing test data" : "Test data hidden"}</span>
        </label>
      </section>
      <ActionFeedback state={action.state} message={action.message} />
      <section>
        <form
          className="directory-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label>
            Record type
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as typeof type);
                setSearch("");
              }}
            >
              <option value="CLIENT">Clients</option>
              <option value="EMPLOYEE">Employees</option>
            </select>
          </label>
          <label className="directory-search">
            Exact-record search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search within this organization"
            />
          </label>
          <button>Search</button>
        </form>
        <div className="candidate-list">
          {rows.map((row) => {
            const key = `${type}:${row.id}`,
              checked = Boolean(selected[key]);
            return (
              <article className="candidate-card" key={row.id}>
                <input
                  aria-label={`Select ${label(row)}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(row)}
                />
                <span>
                  <strong>{label(row)}</strong>
                  <small>
                    {row.status ?? row.employmentStatus}
                    {row.employeeNumber ? ` · ${row.employeeNumber}` : ""}
                  </small>
                  <small>
                    {row.testDataMarkedAt
                      ? "Explicitly marked test data"
                      : "Legacy record — not marked as test data"}
                  </small>
                  {row.testDataReason ? (
                    <small>{row.testDataReason}</small>
                  ) : null}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void mark(row)}
                  >
                    Mark as test data
                  </button>
                </span>
              </article>
            );
          })}
        </div>
      </section>
      <form onSubmit={previewCleanup}>
        <button disabled={!selections.length || action.state === "pending"}>
          Preview cleanup for {selections.length} selected record
          {selections.length === 1 ? "" : "s"}
        </button>
      </form>
      {preview ? (
        <section>
          <h2>Dependency-aware preview</h2>
          <p>
            Expires {new Date(preview.expiresAt).toLocaleString()}. Any record
            or dependency change invalidates this preview.
          </p>
          {preview.records.map((row) => (
            <article
              className="dependency-preview"
              key={`${row.type}:${row.id}`}
            >
              <header>
                <strong>{row.identity}</strong>
                <StatusChip tone={tone(row.classification)}>
                  {row.classification.replaceAll("_", " ")}
                </StatusChip>
              </header>
              <p>{row.reason}</p>
              <dl>
                {Object.entries(row.dependencies).map(([name, count]) => (
                  <div key={name}>
                    <dt>{name.replaceAll(/([A-Z])/g, " $1")}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
          <label>
            Type <strong>CLEAN SELECTED TEST DATA</strong> to execute
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            className="danger"
            disabled={
              confirmation !== "CLEAN SELECTED TEST DATA" ||
              action.state === "pending"
            }
            onClick={() => void execute()}
          >
            Execute classified cleanup
          </button>
        </section>
      ) : null}
      {result ? (
        <section>
          <h2>Execution result</h2>
          {result.outcomes.map((item) => (
            <p key={`${item.type}:${item.id}`}>
              {item.type} · {item.action} · {item.status}
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}
