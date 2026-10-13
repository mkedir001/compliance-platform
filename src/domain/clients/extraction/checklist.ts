/**
 * Assessment-style checklist rows and document facts.
 *
 * Forms such as the Self-Management Assessment are tables: an area name, Yes / No / NA options, and a free-text
 * "assessment" column. The checkbox marks are deliberately NOT read: they are unreliable in scans, and a wrong
 * care answer is worse than a missing one. Instead each row becomes a proposed care item whose answer is left
 * for the reviewer, together with any typed text the form carries for that row. Rows that correspond to a field
 * Waldah already stores (allergies, seizures, diet, ...) propose that field's text instead.
 */
import type { TextLine } from "./semantic";

export type ChecklistProposal = {
  fieldPath: string;
  value: string | Record<string, string>;
  sourceLocation: string;
  confidence: number;
  page: number;
  line: number;
  label: string;
};

export type CareAnswer = "YES" | "NO" | "NA";
export const CARE_ANSWERS: readonly CareAnswer[] = ["YES", "NO", "NA"];

const MARK = String.raw`(?:L\]|LJ|\[[ xX_]?\]|\[_\]|\|)?`;
const ROW = new RegExp(String.raw`^(?<label>.*?\S)\s+(?:${MARK}\s*)?Yes\s*${MARK}\s*No\b\s*${MARK}\s*(?:NA\b)?(?<rest>.*)$`);
const HEALTH_FIELDS: ReadonlyArray<[RegExp, string]> = [
  [/^allerg/i, "health.allergiesReactions"],
  [/^seizure/i, "health.seizureProtocol"],
  [/^chok/i, "health.chokingSwallowingRisk"],
  [/\bdietary\b|\bdiet\b/i, "health.specialDietTexture"],
  [/^chronic medical conditions/i, "health.diagnoses"],
  [/^mobility/i, "health.mobilityEquipment"],
  [/^self-administration of medication/i, "health.medicationResponsibility"],
];

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
function joinWrapped(parts: string[]) {
  let text = "";
  for (const part of parts.map(clean).filter(Boolean)) text += !text ? part : /[-‐]$/.test(text) ? part : ` ${part}`;
  return text;
}
export function careKey(base: string) {
  const words = base.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const key = words.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word)).join("");
  return key.slice(0, 64);
}

type Row = { page: number; line: number; x0: number | null; labelParts: string[]; noteParts: string[] };

function rowsFromPage(lines: readonly TextLine[], page: number): Row[] {
  const rows: Row[] = [];
  let current: Row | null = null;
  let lastY: number | null = null;
  let sinceStart = 0;
  let optionPending = false;
  lines.forEach((line, index) => {
    const text = clean(line.text);
    const match = ROW.exec(text);
    if (match?.groups && match.groups.label.length >= 3) {
      current = { page, line: index + 1, x0: line.box?.x0 ?? null, labelParts: [match.groups.label], noteParts: [clean(match.groups.rest ?? "")] };
      rows.push(current);
      lastY = line.box?.y0 ?? null;
      sinceStart = 0;
      optionPending = false;
      return;
    }
    if (!current) return;
    sinceStart++;
    const box = line.box;
    const near = box && lastY !== null ? box.y0 - lastY <= 0.032 : sinceStart <= 2;
    if (!near) { current = null; return; }
    if (box) lastY = box.y0;
    const x0 = box?.x0 ?? current.x0;
    const offset = x0 !== null && current.x0 !== null ? x0 - current.x0 : 0;
    const segments = line.text.split(/\s{2,}/).map(clean).filter(Boolean);
    if (offset >= 0.25) { current.noteParts.push(segments.join(" ")); return; }
    if (offset >= 0.1) return; // wrapped option text ("NA – there are no ...")
    const [labelPart, ...rest] = segments.length ? segments : [text];
    current.labelParts.push(labelPart);
    let sawOption = false;
    rest.forEach((segment, position) => {
      if (/^NA\s*[–—-]/i.test(segment)) { sawOption = true; return; }
      // A short lowercase fragment right after an "NA – ..." option is that option's wrapped second line.
      if (optionPending && position === 0 && segment.length <= 32 && !/[.;,]/.test(segment) && /^[a-z]/.test(segment)) return;
      current!.noteParts.push(segment);
    });
    optionPending = sawOption;
  });
  return rows;
}

function splitLabel(label: string) {
  const match = /^(.*?)\s*\((?:state|include|be)\b[^)]*\)\s*:?\s*(.*)$/i.exec(label);
  const base = clean((match ? match[1] : label).replace(/:\s*$/, ""));
  return { base, detail: clean(match?.[2] ?? "") };
}

export function extractChecklistProposals(pages: readonly (readonly TextLine[])[], method: "NATIVE_TEXT" | "LOCAL_OCR"): ChecklistProposal[] {
  const out: ChecklistProposal[] = [];
  const seen = new Set<string>();
  const baseConfidence = method === "NATIVE_TEXT" ? 0.75 : 0.62;
  pages.forEach((lines, pageIndex) => {
    for (const row of rowsFromPage(lines, pageIndex + 1)) {
      const { base, detail } = splitLabel(joinWrapped(row.labelParts));
      const note = joinWrapped(row.noteParts);
      if (base.length < 4 || base.length > 120 || !/[a-z]/i.test(base)) continue;
      if (/^other\b/i.test(base) && !detail && !note) continue; // blank template slots
      const text = detail || note;
      const mapped = HEALTH_FIELDS.find(([pattern]) => pattern.test(base));
      const source = `Page ${row.page} line ${row.line} ${method === "LOCAL_OCR" ? "OCR text" : "labeled text"} (assessment row “${base}”)`;
      if (mapped && text) {
        if (seen.has(mapped[1])) continue;
        seen.add(mapped[1]);
        out.push({ fieldPath: mapped[1], value: text, sourceLocation: source, confidence: baseConfidence, page: row.page, line: row.line, label: base });
        continue;
      }
      const key = careKey(base);
      if (!key || seen.has(`care.${key}`)) continue;
      seen.add(`care.${key}`);
      out.push({
        fieldPath: `care.${key}`,
        value: { label: base, answer: "", detail, note },
        sourceLocation: source,
        confidence: Math.round(baseConfidence * 0.9 * 100) / 100,
        page: row.page, line: row.line, label: base,
      });
    }
  });
  return out;
}

/* ----- document facts: assessment/plan dates and who completed the review ----- */

const DATE = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`;
const DOCUMENT_FACTS: ReadonlyArray<{ path: string; pattern: RegExp }> = [
  { path: "document.creationDate", pattern: new RegExp(String.raw`\bdate of [^:]{0,70}?development\s*:?\s*${DATE}`, "i") },
  { path: "document.effectiveDate", pattern: new RegExp(String.raw`\bannual period from\s*:?\s*${DATE}`, "i") },
  { path: "document.periodEnd", pattern: new RegExp(String.raw`\bannual period from\s*:?\s*${DATE}\s*(?:to|-|–|—)\s*${DATE}`, "i") },
  { path: "document.reviewDate", pattern: new RegExp(String.raw`\bplan review and update\s*:?\s*${DATE}`, "i") },
  { path: "document.expirationDate", pattern: new RegExp(String.raw`\b(?:document\s+)?expir(?:ation|es)\s+(?:date|on)\s*[:-]?\s*${DATE}`, "i") },
  { path: "document.completedBy", pattern: /\b[Nn]ame and title of person completing[^:]{0,60}:\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3}(?:\s*,\s*[A-Za-z ./&-]{2,50})?)/ },
];

export function extractDocumentFactProposals(pages: readonly (readonly TextLine[])[], method: "NATIVE_TEXT" | "LOCAL_OCR"): ChecklistProposal[] {
  const out: ChecklistProposal[] = [];
  const found = new Set<string>();
  const confidence = method === "NATIVE_TEXT" ? 0.85 : 0.7;
  pages.forEach((lines, pageIndex) => {
    if (pageIndex > 1) return; // dates and authors sit in the header block
    lines.forEach((line, index) => {
      for (const fact of DOCUMENT_FACTS) {
        if (found.has(fact.path)) continue;
        const match = fact.pattern.exec(line.text.replace(/\s{2,}/g, "  "));
        const value = fact.path === "document.periodEnd" ? match?.[2] : match?.[1];
        if (!value) continue;
        found.add(fact.path);
        out.push({
          fieldPath: fact.path, value: value.trim(), confidence,
          sourceLocation: `Page ${pageIndex + 1} line ${index + 1} ${method === "LOCAL_OCR" ? "OCR text" : "labeled text"}`,
          page: pageIndex + 1, line: index + 1, label: fact.path,
        });
      }
    });
  });
  return out;
}
