"use client";
import { buildCareProfile, careAnswerLabel, type CareProfileDocument, type CareProfileEntry } from "@/domain/clients/care-profile";

const shortDate = (value: string | null) => (value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "date not recorded");
const source = (entry: CareProfileEntry) => `${entry.documentName} · ${shortDate(entry.documentDate)}`;

export function CareProfilePanel({ documents }: { documents: readonly CareProfileDocument[] }) {
  const items = buildCareProfile(documents);
  return <section aria-label="Care profile">
    <h3>Care profile</h3>
    <p>Care routines and safety answers a reviewer accepted from this client&apos;s documents. When a newer document answers the same question, its answer is current and the earlier one stays listed under it. Each answer stays tied to the document it came from.</p>
    {items.length ? items.map(item => <article key={item.key} className="care-profile-item">
      <p className="eyebrow">{source(item.current)}</p>
      <h4>{item.label}: {careAnswerLabel(item.current.answer)}{item.current.detail ? ` — ${item.current.detail}` : ""}</h4>
      {item.current.note ? <small>The form says: {item.current.note}</small> : null}
      {item.ambiguous ? <small role="note">Documents with the same date disagree on this answer. Check the originals and confirm the right one.</small> : null}
      {item.earlier.length ? <details><summary>{item.earlier.length} earlier answer{item.earlier.length === 1 ? "" : "s"}</summary>
        <ul>{item.earlier.map(entry => <li key={`${entry.documentId}:${entry.reviewedAt ?? ""}`}>{careAnswerLabel(entry.answer)}{entry.detail ? ` — ${entry.detail}` : ""} · {source(entry)}</li>)}</ul>
      </details> : null}
    </article>) : <p className="empty-state">No care answers yet. They appear here after you review an imported document, such as a Self-Management Assessment, and save an answer for a care item.</p>}
  </section>;
}
