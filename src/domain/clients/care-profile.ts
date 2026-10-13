/**
 * Care profile: the accepted care facts a client's documents have contributed.
 *
 * Facts live in each imported document's snapshot (`reviewedFacts`), so nothing here needs its own table. When
 * several documents answer the same question, the newest document's answer is current and the others are kept
 * as earlier answers.
 */
export type CareProfileDocument = {
  id: string;
  originalFileName?: string | null;
  status?: string | null;
  authoritativeCompletedAt?: string | Date | null;
  importedAt?: string | Date | null;
  generatedAt?: string | Date | null;
  snapshotJson?: unknown;
};

export type CareAnswerValue = "YES" | "NO" | "NA";
export type CareProfileEntry = {
  answer: CareAnswerValue;
  detail: string;
  note: string;
  documentId: string;
  documentName: string;
  documentDate: string | null;
  reviewedAt: string | null;
};
export type CareProfileItem = { key: string; label: string; current: CareProfileEntry; earlier: CareProfileEntry[]; /** The two newest documents share a date (or have none) but disagree, so the order cannot be trusted. */ ambiguous: boolean };

const ANSWERS: readonly string[] = ["YES", "NO", "NA"];
const asObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const dateText = (value: unknown) => { if (!value) return null; const date = new Date(value as string); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
const titleCase = (key: string) => { const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); return words.charAt(0).toUpperCase() + words.slice(1); };
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
function usDateText(value: string | undefined) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec((value ?? "").trim());
  if (!match) return null;
  const month = Number(match[1]), day = Number(match[2]), year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString() : null;
}

export function careAnswerLabel(answer: string) { return answer === "YES" ? "Yes" : answer === "NO" ? "No" : "Not applicable"; }

export function buildCareProfile(documents: readonly CareProfileDocument[]): CareProfileItem[] {
  const grouped = new Map<string, { label: string; entries: CareProfileEntry[] }>();
  for (const document of documents) {
    if (document.status === "VOIDED") continue;
    const facts = asObject(document.snapshotJson)?.reviewedFacts;
    if (!Array.isArray(facts)) continue;
    // Order by when the assessment applies, never by upload time: use the reviewer-confirmed completion date or
    // dates accepted from the document itself. With no reliable source date, disagreement remains ambiguous.
    const documentFacts = new Map<string, string>();
    for (const raw of facts) { const fact = asObject(raw); if (fact && text(fact.fieldPath).startsWith("document.")) documentFacts.set(text(fact.fieldPath), text(fact.value)); }
    const documentDate = dateText(document.authoritativeCompletedAt) ?? usDateText(documentFacts.get("document.effectiveDate")) ?? usDateText(documentFacts.get("document.creationDate")) ?? usDateText(documentFacts.get("document.reviewDate"));
    for (const raw of facts) {
      const fact = asObject(raw), path = text(fact?.fieldPath);
      if (!fact || !path.startsWith("care.")) continue;
      const value = asObject(fact.value), answer = text(value?.answer).toUpperCase();
      if (!value || !ANSWERS.includes(answer)) continue; // an unanswered item is never part of the profile
      const key = path.slice("care.".length), group = grouped.get(key) ?? { label: text(value.label) || titleCase(key), entries: [] };
      group.entries.push({
        answer: answer as CareAnswerValue, detail: text(value.detail), note: text(value.note),
        documentId: document.id, documentName: document.originalFileName ?? "Document", documentDate, reviewedAt: dateText(fact.reviewedAt),
      });
      grouped.set(key, group);
    }
  }
  return [...grouped.entries()]
    .map(([key, group]) => {
      const entries = [...group.entries].sort((a, b) => (b.documentDate ?? "").localeCompare(a.documentDate ?? "") || (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""));
      const [first, second] = entries;
      return { key, label: group.label, current: first, earlier: entries.slice(1), ambiguous: Boolean(second) && (first.documentDate ?? "") === (second.documentDate ?? "") && (first.answer !== second.answer || first.detail !== second.detail) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Newest accepted answer per care key, for showing "currently on file" while reviewing a new upload. */
export function currentCareAnswers(documents: readonly CareProfileDocument[]) {
  return Object.fromEntries(buildCareProfile(documents).map(item => [item.key, { answer: item.current.answer, detail: item.current.detail, documentName: item.current.documentName, documentDate: item.current.documentDate, ambiguous: item.ambiguous }]));
}
