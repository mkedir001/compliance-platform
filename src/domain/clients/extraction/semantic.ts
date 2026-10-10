/**
 * Layout-aware, label-synonym based field extraction for client import documents.
 *
 * Pipeline: positioned text lines -> label recognition (synonyms, fuzzy, role context)
 * -> value association (same line, then next line) -> validation -> scored proposals.
 *
 * This module is deliberately document-agnostic: it knows canonical client fields and the
 * many ways forms label them, not any particular form. It never guesses a value that fails
 * the field's validator, and every proposal carries a confidence score and its source line.
 */

export type TextBox = { x0: number; y0: number; x1: number; y1: number };
export type TextLine = { text: string; box?: TextBox; confidence?: number };
export type SemanticMethod = "NATIVE_TEXT" | "LOCAL_OCR";
export type SemanticExtraction = {
  fieldPath: string;
  value: string;
  sourceLocation: string;
  confidence: number;
  page: number;
  line: number;
  label: string;
  box?: TextBox;
};

type Role = "client" | "representative" | "emergency" | "caseManager";
type Kind = "name" | "date" | "phone" | "email" | "address" | "city" | "state" | "zip" | "id" | "number" | "boolean" | "text" | "narrative" | "language" | "gender";
type FieldDef = { path: string; role: Role; kind: Kind; synonyms: readonly string[]; explicitRoleOnly?: boolean };

/* ----------------------------------------------------------------------------------------- */
/* Whitespace helpers shared with the OCR / native text steps                                  */
/* ----------------------------------------------------------------------------------------- */

export function flattenText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function splitTextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

type PdfJsItem = { str?: string; transform?: number[]; width?: number; height?: number };

/** Group PDF.js text items into visual lines (top to bottom, left to right) with bounding boxes. */
export function buildNativeLines(items: readonly unknown[], pageWidth?: number, pageHeight?: number): TextLine[] {
  type Positioned = { str: string; x: number; y: number; w: number; h: number };
  const positioned: Positioned[] = [];
  for (const raw of items) {
    const item = raw as PdfJsItem;
    if (typeof item.str !== "string" || !item.str.trim() || !item.transform) continue;
    positioned.push({
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      w: item.width ?? 0,
      h: Math.max(item.height ?? 0, Math.abs(item.transform[3] ?? 0), 4),
    });
  }
  positioned.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Positioned[][] = [];
  for (const item of positioned) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - item.y) <= Math.max(2, item.h * 0.45));
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows
    .sort((a, b) => b[0].y - a[0].y)
    .map(row => {
      row.sort((a, b) => a.x - b.x);
      let text = "";
      let previousEnd: number | null = null;
      for (const item of row) {
        if (previousEnd !== null) text += item.x - previousEnd > item.h * 1.5 ? "  " : " ";
        text += item.str.trim();
        previousEnd = item.x + item.w;
      }
      const x0 = Math.min(...row.map(item => item.x));
      const x1 = Math.max(...row.map(item => item.x + item.w));
      const y0 = Math.min(...row.map(item => item.y));
      const y1 = Math.max(...row.map(item => item.y + item.h));
      const box = pageWidth && pageHeight
        ? { x0: x0 / pageWidth, y0: 1 - y1 / pageHeight, x1: x1 / pageWidth, y1: 1 - y0 / pageHeight }
        : { x0, y0, x1, y1 };
      return { text: text.replace(/[ \t]{3,}/g, "  ").trim(), box };
    })
    .filter(line => line.text);
}

/** Parse Tesseract TSV into normalized, positioned lines without retaining the rendered image. */
export function buildOcrLines(tsv: string): TextLine[] {
  const rows = tsv.split(/\r?\n/);
  if (!rows[0]?.startsWith("level\tpage_num\tblock_num")) return splitTextLines(tsv).map(text => ({ text }));
  type Word = { text:string; left:number; top:number; width:number; height:number; confidence:number };
  const groups = new Map<string, Word[]>();
  let pageWidth = 0, pageHeight = 0;
  for (const row of rows.slice(1)) {
    const columns = row.split("\t");
    if (columns.length < 12) continue;
    const [level,page,block,paragraph,line] = columns,left=columns[6],top=columns[7],width=columns[8],height=columns[9],confidence=columns[10],textColumns=columns.slice(11);
    const numeric = [left,top,width,height,confidence].map(Number);
    if (numeric.some(value => !Number.isFinite(value))) continue;
    if (level === "1") { pageWidth = numeric[2]; pageHeight = numeric[3]; continue; }
    const text = textColumns.join("\t").trim();
    if (level !== "5" || !text) continue;
    const key = `${page}:${block}:${paragraph}:${line}`;
    const words = groups.get(key) ?? [];
    words.push({ text, left:numeric[0], top:numeric[1], width:numeric[2], height:numeric[3], confidence:numeric[4] });
    groups.set(key, words);
  }
  if (!pageWidth || !pageHeight) return [];
  return [...groups.values()].map(words => {
    words.sort((left,right)=>left.left-right.left);
    const left=Math.min(...words.map(word=>word.left)),top=Math.min(...words.map(word=>word.top));
    const right=Math.max(...words.map(word=>word.left+word.width)),bottom=Math.max(...words.map(word=>word.top+word.height));
    const accepted=words.filter(word=>word.confidence>=0),confidence=accepted.length?accepted.reduce((sum,word)=>sum+word.confidence,0)/accepted.length/100:undefined;
    return {text:words.map(word=>word.text).join(" "),box:{x0:left/pageWidth,y0:top/pageHeight,x1:right/pageWidth,y1:bottom/pageHeight},confidence};
  }).sort((left,right)=>(left.box?.y0??0)-(right.box?.y0??0)||(left.box?.x0??0)-(right.box?.x0??0));
}

/* ----------------------------------------------------------------------------------------- */
/* Canonical fields and the ways forms label them                                              */
/* ----------------------------------------------------------------------------------------- */

const CLIENT_NAME_LABELS = [
  "name of person served", "person served name", "name of the person served", "person served",
  "client name", "name of client", "clients name", "client s name", "name of the client",
  "individual name", "name of individual", "name of the individual", "individuals name", "individual s name",
  "name of individual receiving services", "individual receiving services", "individual needing help",
  "individual needing services", "person receiving services", "name of person receiving services",
  "person receiving supports", "recipient name", "name of recipient", "recipient s name", "participant name",
  "name of participant", "consumer name", "name of consumer", "patient name", "name of patient", "member name",
  "name of person", "person s name", "legal name", "full name", "client full name", "person name",
  "client", "individual", "recipient", "participant", "consumer", "name",
];

const FIELD_DEFS: readonly FieldDef[] = [
  { path: "identity.fullName", role: "client", kind: "name", synonyms: CLIENT_NAME_LABELS },
  { path: "client.legalFirstName", role: "client", kind: "name", synonyms: ["legal first name", "first name", "given name", "client first name", "person served first name"] },
  { path: "client.legalLastName", role: "client", kind: "name", synonyms: ["legal last name", "last name", "surname", "family name", "client last name", "person served last name"] },
  { path: "client.dateOfBirth", role: "client", kind: "date", synonyms: ["date of birth", "dob", "birth date", "birthdate", "birthday", "born"] },
  { path: "client.phone", role: "client", kind: "phone", synonyms: ["phone", "phone number", "telephone", "telephone number", "home phone", "home telephone", "home telephone number", "home phone number", "cell phone", "cell phone number", "cell", "mobile", "mobile phone", "contact number", "phone no"] },
  { path: "client.email", role: "client", kind: "email", synonyms: ["email", "e mail", "email address", "e mail address"] },
  { path: "client.addressLine1", role: "client", kind: "address", synonyms: ["address", "home address", "street address", "mailing address", "residential address", "residence", "address line 1", "physical address"] },
  { path: "client.city", role: "client", kind: "city", synonyms: ["city", "town"] },
  { path: "client.state", role: "client", kind: "state", synonyms: ["state"] },
  { path: "client.postalCode", role: "client", kind: "zip", synonyms: ["zip", "zip code", "postal code", "zipcode"] },
  { path: "client.maPmiNumber", role: "client", kind: "id", synonyms: ["ma pmi", "ma pmi number", "pmi", "pmi number", "pmi no", "pmi id", "medical assistance number", "medical assistance", "medical assistance id", "ma number", "ma id", "ma no", "ma pmi no"] },
  { path: "client.gender", role: "client", kind: "gender", synonyms: ["gender", "sex"] },
  { path: "client.primaryLanguage", role: "client", kind: "language", synonyms: ["primary language", "language", "languages spoken", "language s spoken", "languages", "preferred language"] },
  { path: "client.interpreterNeeded", role: "client", kind: "boolean", synonyms: ["interpreter needed", "interpreter required", "needs interpreter"] },
  { path: "client.waiverProgram", role: "client", kind: "text", synonyms: ["waiver program", "waiver or funding program", "funding program"] },
  { path: "services.0.serviceType", role: "client", kind: "text", synonyms: ["service type", "type of service", "service to be provided", "services to be provided"] },
  { path: "services.0.startDate", role: "client", kind: "date", synonyms: ["service start date", "date of admission", "admission date", "date of admission or re admission", "date services begin", "start of services", "service initiation date", "date of service initiation"] },
  { path: "services.0.authorizedHours", role: "client", kind: "number", synonyms: ["authorized hours", "hours authorized", "approved hours"] },
  { path: "services.0.authorizedUnits", role: "client", kind: "number", synonyms: ["authorized units", "units authorized", "approved units"] },
  { path: "services.0.authorizationIdentifier", role: "client", kind: "id", synonyms: ["service authorization number", "service authorization id", "authorization number", "authorization id"] },
  { path: "services.0.authorizationStart", role: "client", kind: "date", synonyms: ["authorization start date", "authorization effective date"] },
  { path: "services.0.authorizationEnd", role: "client", kind: "date", synonyms: ["authorization end date", "authorization expiration date"] },
  { path: "representatives.0.name", role: "representative", kind: "name", synonyms: ["legal representative", "legal representative name", "name of legal representative", "legal guardian", "guardian", "guardian name", "name of guardian", "authorized representative", "responsible party", "parent guardian"] },
  { path: "representatives.0.relationship", role: "representative", kind: "text", synonyms: ["relationship", "relationship to person served", "relationship to client", "relation"], explicitRoleOnly: true },
  { path: "representatives.0.phone", role: "representative", kind: "phone", synonyms: ["phone", "phone number", "telephone", "cell phone", "cell", "mobile"], explicitRoleOnly: true },
  { path: "representatives.0.email", role: "representative", kind: "email", synonyms: ["email", "email address", "e mail"], explicitRoleOnly: true },
  { path: "emergencyContacts.0.name", role: "emergency", kind: "name", synonyms: ["emergency contact", "primary emergency contact", "emergency contact name", "emergency contact person", "name of emergency contact", "in case of emergency contact"] },
  { path: "emergencyContacts.0.relationship", role: "emergency", kind: "text", synonyms: ["relationship"], explicitRoleOnly: true },
  { path: "emergencyContacts.0.phone", role: "emergency", kind: "phone", synonyms: ["phone", "phone number", "telephone", "cell phone", "cell", "mobile"], explicitRoleOnly: true },
  { path: "caseManager.name", role: "caseManager", kind: "name", synonyms: ["case manager", "case manager name", "name of case manager", "care coordinator", "care coordinator name", "service coordinator", "service coordinator name", "case manager care coordinator", "county case manager", "social worker", "case worker"] },
  { path: "caseManager.agency", role: "caseManager", kind: "text", synonyms: ["agency", "case management agency", "case manager agency", "county", "organization"], explicitRoleOnly: true },
  { path: "caseManager.phone", role: "caseManager", kind: "phone", synonyms: ["phone", "phone number", "telephone", "cell phone", "mobile"], explicitRoleOnly: true },
  { path: "caseManager.email", role: "caseManager", kind: "email", synonyms: ["email", "email address", "e mail"], explicitRoleOnly: true },
  { path: "health.primaryCareProvider", role: "client", kind: "text", synonyms: ["primary care provider", "primary physician", "primary doctor"] },
  { path: "health.clinic", role: "client", kind: "text", synonyms: ["primary care clinic", "medical clinic", "clinic"] },
  { path: "health.providerPhone", role: "client", kind: "phone", synonyms: ["primary care provider phone", "provider phone", "clinic phone"] },
  { path: "health.dentist", role: "client", kind: "text", synonyms: ["dentist", "dental provider"] },
  { path: "health.pharmacy", role: "client", kind: "text", synonyms: ["pharmacy", "preferred pharmacy"] },
  { path: "health.pharmacyPhone", role: "client", kind: "phone", synonyms: ["pharmacy phone", "pharmacy telephone"] },
  { path: "health.healthInsurancePlan", role: "client", kind: "text", synonyms: ["health insurance plan", "health plan", "insurance plan"] },
  { path: "health.memberId", role: "client", kind: "id", synonyms: ["health plan member id", "insurance member id", "member id"] },
  { path: "health.diagnoses", role: "client", kind: "narrative", synonyms: ["diagnoses", "diagnosis", "health conditions", "medical conditions"] },
  { path: "health.allergiesReactions", role: "client", kind: "narrative", synonyms: ["allergies and reactions", "allergies reactions", "allergies"] },
];

/**
 * Labels that name a role in the label text itself (for example "Case manager phone").
 * They are checked before synonym matching so "case manager phone" resolves to the case
 * manager's phone, not the client's.
 */
const ROLE_WORDS: readonly [Role, readonly string[]][] = [
  ["caseManager", ["case manager", "care coordinator", "service coordinator", "social worker", "case worker"]],
  ["representative", ["legal representative", "guardian", "authorized representative", "responsible party"]],
  ["emergency", ["emergency contact"]],
];

/** Labels whose values are never client data (staff, providers, dates of plan activity). */
const NON_CLIENT_CONTEXT = ["completing", "completed by", "prepared by", "preparing", "program manager", "designated coordinator", "license holder", "licensed provider", "staff person", "title of person"];

/** Words that begin the label of the next field; used to end a free-text value on a flattened line. */
const LABEL_STARTERS = new Set([
  "date", "dates", "name", "case", "legal", "phone", "address", "email", "plan", "for", "title", "city", "state", "zip",
  "dob", "service", "services", "relationship", "emergency", "guardian", "provider", "signature", "ma", "pmi", "gender",
  "language", "county", "agency", "program", "annual", "review", "completion", "telephone", "cell", "home", "primary",
  "authorized", "responsible", "social", "care", "within", "describe", "radiant",
]);

const STATES = new Set(["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming"]);

/* ----------------------------------------------------------------------------------------- */
/* Tokenizing and label matching                                                               */
/* ----------------------------------------------------------------------------------------- */

type Token = { text: string; norm: string; start: number; end: number };

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  for (const match of line.matchAll(/[A-Za-z0-9][A-Za-z0-9]*/g)) {
    tokens.push({ text: match[0], norm: match[0].toLowerCase(), start: match.index!, end: match.index! + match[0].length });
  }
  return tokens;
}

function editDistanceAtMostOne(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokensMatch(token: string, expected: string) {
  if (token === expected) return 1;
  if (expected.length >= 5 && token.length >= 5 && editDistanceAtMostOne(token, expected)) return 0.85;
  return 0;
}

type CompiledSynonym = { def: FieldDef; words: string[]; text: string };
const COMPILED: CompiledSynonym[] = FIELD_DEFS
  .flatMap(def => def.synonyms.map(text => ({ def, words: text.split(" "), text })))
  .sort((a, b) => b.words.length - a.words.length || b.text.length - a.text.length);

type LabelHit = {
  def: FieldDef;
  label: string;
  start: number;
  end: number;
  delimited: boolean;
  fuzzy: boolean;
  tokenIndex: number;
  tokenCount: number;
};

function delimiterAfter(line: string, end: number): { delimited: boolean; end: number } {
  const rest = line.slice(end);
  const match = rest.match(/^\s*(?:[:\-–—]|,(?=\s))\s*/);
  return match ? { delimited: true, end: end + match[0].length } : { delimited: false, end };
}

function findLabels(line: string, tokens: Token[]): LabelHit[] {
  const hits: LabelHit[] = [];
  let index = 0;
  while (index < tokens.length) {
    let best: LabelHit | null = null;
    for (const synonym of COMPILED) {
      if (index + synonym.words.length > tokens.length) continue;
      let score = 1;
      let ok = true;
      for (let offset = 0; offset < synonym.words.length; offset++) {
        const s = tokensMatch(tokens[index + offset].norm, synonym.words[offset]);
        if (!s) { ok = false; break; }
        score = Math.min(score, s);
      }
      if (!ok) continue;
      const last = tokens[index + synonym.words.length - 1];
      let delimiter = delimiterAfter(line, last.end);
      // A comma only counts as a label delimiter for capitalised labels; "…a case manager, employer…" is prose.
      if (delimiter.delimited && line[last.end - 0] !== undefined && /^\s*,/.test(line.slice(last.end)) && !/^[A-Z]/.test(tokens[index].text)) delimiter = { delimited: false, end: last.end };
      const next = tokens[index + synonym.words.length]?.norm;
      if (next && ["completing", "completed", "preparing", "prepared"].includes(next)) continue;
      if (!delimiter.delimited && synonym.def.explicitRoleOnly) continue;
      const hit: LabelHit = {
        def: synonym.def,
        label: tokens.slice(index, index + synonym.words.length).map(t => t.text).join(" "),
        start: tokens[index].start,
        end: delimiter.end,
        delimited: delimiter.delimited,
        fuzzy: score < 1,
        tokenIndex: index,
        tokenCount: synonym.words.length,
      };
      // Longest synonym wins at this position; prefer delimited matches over undelimited ones.
      if (!best || (!best.delimited && hit.delimited)) best = hit;
      if (best.delimited) break;
    }
    if (best) {
      // Without a delimiter only strongly typed labels (validated later) are trusted; other matches are
      // ordinary words in a sentence and must neither produce values nor end another label's value.
      if (best.delimited || ["date", "phone", "email"].includes(best.def.kind)) hits.push(best);
      index += best.tokenCount;
    } else {
      index++;
    }
  }
  return hits;
}

/* ----------------------------------------------------------------------------------------- */
/* Value extraction and validation                                                             */
/* ----------------------------------------------------------------------------------------- */

const DATE_PATTERN = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function isPlausibleDate(value: string) {
  const parts = value.split(/[/-]/).map(Number);
  if (value.includes("-") && /^\d{4}-/.test(value)) {
    const [y, m, d] = parts;
    return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }
  const [m, d, yRaw] = parts;
  const y = yRaw < 100 ? (yRaw > 30 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100;
}

function takeName(rest: string): string | null {
  const cleaned = rest.replace(/^[\s"'(\[]+/, "");
  const tokens = [...cleaned.matchAll(/[A-Za-z][A-Za-z'’.-]*(?:,)?/g)];
  const words: string[] = [];
  for (let i = 0; i < tokens.length && words.length < 5; i++) {
    const word = tokens[i][0];
    const bare = word.replace(/[,.]/g, "").toLowerCase();
    if (i > 0 && LABEL_STARTERS.has(bare) && words.length >= 2) break;
    if (i > 0 && LABEL_STARTERS.has(bare) && /^[A-Z]/.test(word) && labelColonFollows(cleaned, tokens[i].index!)) break;
    if (/^(and|of|the|or|to|is|are|was|has|have|with|for)$/.test(bare)) break;
    // A name token may not be followed by a digit run (it would be part of an id or phone).
    // Keep the comma on a leading "Last," so "Last, First" can be split correctly later.
    words.push(i === 0 ? word : word.replace(/,$/, ""));
    if (words.length >= 2 && words[0].endsWith(",")) break;
    if (word.endsWith(",") && i > 0 && words.length >= 2) break;
  }
  const value = words.join(" ").replace(/[.,]+$/, "").trim();
  if (value.length < 2 || value.length > 60) return null;
  if (!/^[A-Za-z][A-Za-z'’., -]*$/.test(value)) return null;
  // Person names: at least two words, each capitalised (lower-case particles such as "van" or "de" allowed).
  // This rejects prose ("you", "an advocate") and most OCR noise from handwriting.
  const nameWords = value.replace(/,/g, "").split(/\s+/).filter(Boolean);
  if (nameWords.length < 2) return null;
  const particles = new Set(["de", "del", "van", "von", "der", "la", "le", "bin", "al", "el", "st", "da", "di", "jr", "sr", "ii", "iii"]);
  if (nameWords.some(word => !/^[A-Z]/.test(word) && !particles.has(word.toLowerCase().replace(/\./g, "")))) return null;
  if (nameWords.some(word => /[A-Z]{2,}[a-z]|[a-z]{2,}[A-Z]/.test(word) && word !== word.toUpperCase())) return null;
  if (value.split(" ").every(part => LABEL_STARTERS.has(part.toLowerCase()))) return null;
  return value;
}

function labelColonFollows(text: string, from: number) {
  const slice = text.slice(from, from + 70);
  const colon = slice.indexOf(":");
  return colon > 0 && slice.slice(0, colon).split(/\s+/).length <= 7;
}

function takeValue(kind: Kind, rest: string): string | null {
  const text = rest.trim();
  if (!text) return null;
  switch (kind) {
    case "name":
      return takeName(text);
    case "date": {
      const match = text.match(DATE_PATTERN);
      return match && isPlausibleDate(match[1]) && text.slice(0, match.index).split(/\s+/).filter(Boolean).length <= 2 ? match[1] : null;
    }
    case "phone": {
      const match = text.match(PHONE_PATTERN);
      return match && (text.slice(0, match.index).replace(/[^A-Za-z]/g, "").length <= 6) ? match[0].trim() : null;
    }
    case "email": {
      const match = text.match(EMAIL_PATTERN);
      return match ? match[0] : null;
    }
    case "zip": {
      const match = text.match(/^\D{0,3}(\d{5}(?:-\d{4})?)\b/);
      return match ? match[1] : null;
    }
    case "state": {
      const first = text.match(/^([A-Za-z]{2})\b/);
      if (first && first[1] === first[1].toUpperCase()) return first[1];
      const full = [...STATES].find(state => text.toLowerCase().startsWith(state));
      return full ? text.slice(0, full.length) : null;
    }
    case "city": {
      const match = text.match(/^([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:state|zip|postal)\b|,|$)/i);
      return match && !/\d/.test(match[1]) ? match[1].trim() : null;
    }
    case "address": {
      const match = text.match(/^(\d{1,6}\s+[A-Za-z0-9 .#'-]{2,80}?)(?=\s+(?:city|state|zip|postal|phone|telephone|email|home\s+telephone)\b|\s{2,}|,\s*[A-Za-z]|$)/i);
      return match ? match[1].trim() : null;
    }
    case "id": {
      const match = text.match(/^\W{0,2}([A-Za-z0-9][A-Za-z0-9-]{4,29})\b/);
      return match && /\d/.test(match[1]) ? match[1] : null;
    }
    case "number": {
      const match=text.match(/^\D{0,2}(\d+(?:\.\d{1,2})?)\b/);
      return match?match[1]:null;
    }
    case "boolean": {
      const match=text.match(/^(yes|no|true|false|needed|not needed|required|not required)\b/i);
      return match?match[1]:null;
    }
    case "language": {
      const head = text.split(/\s{2,}/)[0];
      const match = head.match(/^([A-Z][a-z]{3,}(?:\s*(?:,|\/|&|and|-)\s*[A-Z][a-z]{3,})*)/);
      return match ? match[1].trim() : null;
    }
    case "gender": {
      const match = text.match(/^(male|female|man|woman|non-?binary|transgender|other|m|f)\b/i);
      return match ? match[1] : null;
    }
    case "text": {
      const head = text.split(/\s{2,}/)[0];
      const stop = head.search(/\s+[A-Z][A-Za-z ]{1,30}:/);
      const value = (stop > 0 ? head.slice(0, stop) : head).trim().replace(/[.;,]+$/, "");
      // Plain words only: symbols or case flips inside a word are OCR noise, not data.
      if (!/^[A-Za-z][A-Za-z0-9 .,'&/()-]*$/.test(value)) return null;
      if (value.split(/\s+/).some(word => /[A-Z]{2,}[a-z]|[a-z]{2,}[A-Z]/.test(word) && word !== word.toUpperCase())) return null;
      return value.length >= 2 && value.length <= 40 && !/\d{4,}/.test(value) ? value : null;
    }
    case "narrative": {
      const head=text.split(/\s{2,}/)[0];
      const stop=head.search(/\s+[A-Z][A-Za-z /()-]{1,40}:/);
      const value=(stop>0?head.slice(0,stop):head).trim().replace(/[.;,]+$/,"");
      return value.length>=2&&value.length<=500?value:null;
    }
  }
}

/* ----------------------------------------------------------------------------------------- */
/* Role context                                                                                */
/* ----------------------------------------------------------------------------------------- */

function explicitRoleFromLabel(labelStartToken: number, tokens: Token[], hit: LabelHit): Role | null {
  // A role named inside, or immediately before, the label ("Case manager phone", "Guardian: phone").
  const window = tokens.slice(Math.max(0, labelStartToken - 3), labelStartToken + hit.tokenCount).map(t => t.norm).join(" ");
  for (const [role, words] of ROLE_WORDS) if (words.some(word => window.includes(word))) return role;
  return null;
}

/* ----------------------------------------------------------------------------------------- */
/* Main extraction                                                                              */
/* ----------------------------------------------------------------------------------------- */

type Candidate = SemanticExtraction;

const CONTACT_SUFFIXES = new Set(["phone", "email", "relationship", "agency"]);
function pathForRole(role: Role, suffix: string): string | null {
  const table: Record<Role, Record<string, string>> = {
    client: { phone: "client.phone", email: "client.email" },
    representative: { phone: "representatives.0.phone", email: "representatives.0.email", relationship: "representatives.0.relationship" },
    emergency: { phone: "emergencyContacts.0.phone", relationship: "emergencyContacts.0.relationship" },
    caseManager: { phone: "caseManager.phone", email: "caseManager.email", agency: "caseManager.agency" },
  };
  return table[role][suffix] ?? null;
}

function splitPersonName(full: string): { first: string; last: string } | null {
  const trimmed = full.trim();
  if (trimmed.includes(",")) {
    const [last, first] = trimmed.split(",").map(part => part.trim());
    if (first && last) return { first: first.split(/\s+/)[0], last };
    return null;
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

export function extractSemanticFields(pages: readonly (readonly TextLine[])[], method: SemanticMethod): SemanticExtraction[] {
  const candidates: Candidate[] = [];
  const methodFactor = method === "LOCAL_OCR" ? 0.9 : 1;

  pages.forEach((lines, pageIndex) => {
    // Role context learned from the most recent role label within the previous few lines.
    let recentRole: { role: Role; lineIndex: number } | null = null;

    lines.forEach((line, lineIndex) => {
      const text = line.text;
      const tokens = tokenize(text);
      if (!tokens.length) return;
      const hits = findLabels(text, tokens);

      hits.forEach(hit => {
        const def = hit.def;
        const explicit = explicitRoleFromLabel(hit.tokenIndex, tokens, hit);
        const inherited = recentRole && lineIndex - recentRole.lineIndex <= 3 ? recentRole.role : null;
        const suffix = def.path.split(".").pop()!;

        // Contact-style fields (phone, email, relationship, agency) belong to whichever role the label or
        // the surrounding section names; the dictionary lists them once and the role decides the target.
        if (CONTACT_SUFFIXES.has(suffix)) {
          const role: Role = explicit ?? inherited ?? "client";
          const target = pathForRole(role, suffix);
          if (target) pushCandidate(target, def, hit, explicit ? 1 : role === "client" ? 1 : 0.8);
          return;
        }

        // Names: a person-served name is never taken from a line about staff or the plan author.
        if (def.path === "identity.fullName") {
          const around = tokens.slice(Math.max(0, hit.tokenIndex - 6), hit.tokenIndex + hit.tokenCount + 2).map(t => t.norm).join(" ");
          if (NON_CLIENT_CONTEXT.some(word => around.includes(word)) || (explicit && explicit !== "client")) return;
          // Generic role words are not client identity evidence on their own. Near the document top they
          // still require an adjacent demographic/client anchor, and never override an active staff role.
          if (/^(name|client|individual|recipient|participant|consumer)$/i.test(hit.label.trim())) {
            const context=lines.slice(Math.max(0,lineIndex-2),lineIndex+4).map(item=>item.text).join(" ").toLowerCase();
            const anchored=/\b(?:date of birth|dob|birth date|ma\s*\/?\s*pmi|medical assistance|person served|home address|street address)\b/.test(context);
            if(pageIndex>0||lineIndex>10||hit.tokenIndex>25||recentRole||!anchored)return;
          }
        }
        pushCandidate(def.path, def, hit, 1);
      });

      function pushCandidate(path: string, def: FieldDef, hit: LabelHit, roleFactor: number) {
        const hitIndex = hits.indexOf(hit);
        const endOfValue = hits[hitIndex + 1]?.start ?? text.length;
        let value = takeValue(def.kind, text.slice(hit.end, endOfValue));
        let positionFactor = 1;
        let sourceBox=line.box,sourceConfidence=line.confidence;
        if (value === null && !text.slice(hit.end, endOfValue).trim() && hit.delimited) {
          const nearby = lines.slice(lineIndex + 1, lineIndex + 4)
            .map((candidate,offset)=>({candidate,offset,distance:spatialDistance(line,candidate)}))
            .filter(({candidate,distance})=>Boolean(candidate.text)&&!findLabels(candidate.text,tokenize(candidate.text)).length&&!/^[A-Z][A-Za-z ()/]{1,40}:/.test(candidate.text)&&(distance!==null||!line.box||!candidate.box))
            .sort((left,right)=>(left.distance??left.offset+1)-(right.distance??right.offset+1));
          for(const {candidate,offset,distance} of nearby){
            value=takeValue(def.kind,candidate.text);
            if(value!==null){positionFactor=distance===null?0.7-offset*0.08:Math.max(0.55,0.82-distance);sourceBox=candidate.box;sourceConfidence=candidate.confidence;break}
          }
        }
        if (value === null) return;

        // Delimiter-free matches are only trusted for strongly typed values.
        if (!hit.delimited && !["date", "phone", "email"].includes(def.kind)) return;

        const bareName = def.kind === "name" && def.path === "identity.fullName" && /^name$/i.test(hit.label.trim()) ? 0.6 : /^(client|individual|recipient|participant|consumer)$/i.test(hit.label) ? 0.8 : 1;
        const fuzzy = hit.fuzzy ? 0.85 : 1;
        const delimited = hit.delimited ? 1 : 0.7;
        const ocrQuality=method==="LOCAL_OCR"&&sourceConfidence!==undefined?Math.max(0.55,sourceConfidence):1;
        const confidence = Math.round(Math.max(0.05, Math.min(1, fuzzy * positionFactor * roleFactor * methodFactor * delimited * bareName * ocrQuality)) * 100) / 100;
        const base = { value, page: pageIndex + 1, line: lineIndex + 1, label: hit.label, box: sourceBox };
        const location = `Page ${pageIndex + 1} line ${lineIndex + 1} ${method === "LOCAL_OCR" ? "OCR text" : "labeled text"} (label “${hit.label}”)`;

        if (path === "identity.fullName") {
          candidates.push({ ...base, fieldPath: path, sourceLocation: location, confidence });
          const split = splitPersonName(value);
          if (split) {
            const nameConfidence = Math.round(confidence * (value.split(/\s+/).length > 2 ? 0.85 : 0.95) * 100) / 100;
            candidates.push({ ...base, value: split.first, fieldPath: "client.legalFirstName", sourceLocation: location, confidence: nameConfidence });
            candidates.push({ ...base, value: split.last, fieldPath: "client.legalLastName", sourceLocation: location, confidence: nameConfidence });
          }
          return;
        }
        candidates.push({ ...base, fieldPath: path, sourceLocation: location, confidence });
      }

      // Remember the role named on this line for the next few lines (for "Phone:" under "Case manager:").
      for (const hit of hits) {
        const explicit = explicitRoleFromLabel(hit.tokenIndex, tokens, hit);
        if (explicit) recentRole = { role: explicit, lineIndex };
      }
    });
  });

  // Keep the strongest provenance for each distinct value. Different plausible values remain separate
  // so the existing import reconciliation step can require an explicit human conflict decision.
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key=`${candidate.fieldPath}:${candidate.value.trim().toLowerCase().replace(/\s+/g," ")}`;
    const current = best.get(key);
    if (!current || candidate.confidence > current.confidence) best.set(key, candidate);
  }
  const strongest=new Map<string,number>();
  for(const candidate of best.values())strongest.set(candidate.fieldPath,Math.max(strongest.get(candidate.fieldPath)??0,candidate.confidence));
  return [...best.values()].filter(candidate=>candidate.confidence>=(strongest.get(candidate.fieldPath)??0)-0.1).sort((a, b) => a.page - b.page || a.line - b.line);
}

function spatialDistance(label:TextLine,candidate:TextLine){
  if(!label.box||!candidate.box)return null;
  const vertical=candidate.box.y0-label.box.y1;
  if(vertical < -0.015 || vertical > 0.12)return null;
  const overlap=Math.max(0,Math.min(label.box.x1,candidate.box.x1)-Math.max(label.box.x0,candidate.box.x0));
  const aligned=Math.abs(candidate.box.x0-label.box.x0)<=0.12||overlap>0;
  if(!aligned)return null;
  return Math.max(0,vertical)+Math.abs(candidate.box.x0-label.box.x0)*0.25;
}

/** Build lines from page strings that were already flattened (no layout available). */
export function linesFromFlatText(pages: readonly string[]): TextLine[][] {
  return pages.map(page => (page.trim() ? [{ text: page.trim() }] : []));
}
