import { normalizeMedicareNumber } from "./medicare-number";

/**
 * Maps the fillable Radiant Care "Services Referral Form" (AcroForm field names such as client_name,
 * client_dob, svc_ihs_with_training) onto the client import proposal paths. Pure functions, no I/O.
 * The referrals module keeps its own mapping for the referral workflow; this one feeds the client import.
 */
export type CareFactValue = { label: string; answer: "YES"; detail: string; note: string };
export type ReferralFormProposal = { fieldPath: string; value: string | boolean | CareFactValue };
type Raw = Record<string, string | boolean>;

const PHONE = /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** The form is recognized by its own field names, not by file name or text. */
export function isReferralFormFields(fieldNames: string[]) {
  return fieldNames.includes("client_name") && fieldNames.includes("client_dob") && fieldNames.some(name => name.startsWith("svc_"));
}

export function splitFullName(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.includes(",")) { const [last, ...rest] = text.split(","); const first = rest.join(" ").trim(); return first && last.trim() ? { first, last: last.trim() } : null; }
  const parts = text.split(" ");
  return parts.length < 2 ? null : { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Free-text phone boxes often hold "Name 507-555-1234"; keep only the number. */
export const phoneFromText = (value: string) => PHONE.exec(value)?.[0].trim() ?? null;
export const emailFromText = (value: string) => EMAIL.exec(value)?.[0] ?? null;

/** Multi-word cities that a "last word is the city" rule would split. Matched case-insensitively at the end of the street+city text, longest first. */
const MULTI_WORD_CITIES = [
  "Brooklyn Park", "Brooklyn Center", "Maple Grove", "Maple Plain", "Eden Prairie", "Coon Rapids", "Apple Valley", "New Brighton", "New Hope", "New Prague", "Golden Valley",
  "Oak Park Heights", "White Bear Lake", "Lake Elmo", "Inver Grove Heights", "Cottage Grove", "Little Canada", "Mounds View", "Spring Lake Park", "Falcon Heights", "Prior Lake",
  "Elk River", "Forest Lake", "Columbia Heights", "Mendota Heights", "Lino Lakes", "Circle Pines", "North Branch", "Big Lake", "Fort Snelling", "Mound City",
];
const SAINT = /^(?:st\.?|saint)$/i;

/** Where the city starts in the words before the state: handles St./Saint prefixes ("St. Paul", "North St. Paul", "St. Louis Park") and known multi-word cities. */
function cityStart(words: string[]) {
  const text = words.join(" ").toLowerCase();
  for (const city of [...MULTI_WORD_CITIES].sort((x, y) => y.length - x.length)) {
    const count = city.split(" ").length;
    if (words.length > count && text.endsWith(` ${city.toLowerCase()}`)) return words.length - count;
  }
  const last = words.length - 1;
  let start = last;
  if (last >= 1 && SAINT.test(words[last - 1])) start = last - 1;
  else if (last >= 2 && SAINT.test(words[last - 2]) && /^park$/i.test(words[last])) start = last - 2;
  if (start < last && start >= 1 && /^(?:north|south|west)$/i.test(words[start - 1])) start -= 1;
  return start;
}

/** "395 Luella Street N Apt #302 St. Paul, MN 55119", "1203 8TH ST NW Austin MN 55912", "12 Oak Ave, Austin, MN 55912". Falls back to the whole text as the street line. */
export function splitAddress(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const tail = /^(.*?)[,\s]+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(text);
  if (!tail) return { addressLine1: text };
  const head = tail[1], state = tail[2].toUpperCase(), postalCode = tail[3];
  if (head.includes(",")) { const index = head.lastIndexOf(","); const street = head.slice(0, index).trim(), city = head.slice(index + 1).trim(); return street && city ? { addressLine1: street, city, state, postalCode } : { addressLine1: text }; }
  const words = head.split(" ");
  if (words.length < 3) return { addressLine1: text };
  const start = cityStart(words);
  return start < 2 ? { addressLine1: text } : { addressLine1: words.slice(0, start).join(" "), city: words.slice(start).join(" "), state, postalCode };
}

const PERIODS: Record<string, string> = { day: "daily", daily: "daily", week: "weekly", weekly: "weekly", month: "monthly", monthly: "monthly", year: "yearly", yearly: "yearly", annual: "yearly", annually: "yearly" };

/** "16 hours daily", "40 hrs/week", "8 hours per day", "20" -> hours plus the period the intake requires (daily, weekly, monthly, yearly). */
export function parseRequestedHours(value: string) {
  const text = value.toLowerCase().replace(/\s+/g, " ").trim();
  const hours = /(\d+(?:\.\d{1,2})?)/.exec(text)?.[1];
  if (!hours) return null;
  const word = /\b(daily|day|weekly|week|monthly|month|yearly|year|annually|annual)\b/.exec(text)?.[1];
  return { hours, period: word ? PERIODS[word] : null };
}

/** Service boxes → Waldah service types. Services without a Waldah equivalent become OTHER (the reviewer sees it and can correct). */
const SERVICE_TYPES: [string[], string][] = [
  [["svc_ihs_without_training"], "IHS_WITHOUT_TRAINING"], [["svc_ihs_with_training"], "IHS_WITH_TRAINING"], [["svc_ihs_family_training"], "IHS_WITH_FAMILY_TRAINING"],
  [["svc_respite_in_home", "svc_respite_out_of_home"], "RESPITE"], [["svc_homemaker"], "HOMEMAKING"],
  [["svc_night_supervision"], "OVERNIGHT_SLEEP"],
  [["svc_icls", "svc_sils", "svc_companion", "svc_emergency", "svc_employment_exploration", "svc_other"], "OTHER"]
];

export function referralFormProposals(raw: Raw): ReferralFormProposal[] {
  const out: ReferralFormProposal[] = [], text = (key: string) => typeof raw[key] === "string" ? (raw[key] as string).trim() : "", checked = (key: string) => raw[key] === true || raw[key] === "Yes";
  const add = (fieldPath: string, value: string | null | undefined) => { if (value) out.push({ fieldPath, value }); };
  // The care profile holds each item as a reviewed answer plus detail. Free-text form entries are recorded as "Yes, provided" with the text as the detail.
  const care = (key: string, label: string, detail: string) => { if (detail.trim()) out.push({ fieldPath: `care.${key}`, value: { label, answer: "YES", detail: detail.trim(), note: "" } }); };

  const name = splitFullName(text("client_name"));
  add("client.legalFirstName", name?.first); add("client.legalLastName", name?.last);
  add("client.dateOfBirth", text("client_dob"));
  add("client.gender", checked("client_male") ? "Male" : checked("client_female") ? "Female" : null);
  add("client.phone", phoneFromText(text("client_phone"))); add("client.email", emailFromText(text("client_email")));
  const address = splitAddress(text("service_address"));
  if (address) for (const [key, value] of Object.entries(address)) add(`client.${key}`, value);
  add("client.maPmiNumber", text("medicaid_number")); add("client.waiverProgram", text("waiver_program"));
  add("health.diagnoses", text("primary_diagnosis")); add("health.medicareNumber", normalizeMedicareNumber(text("medicare_number")));
  const insurance = [checked("ins_medicaid") ? "Medicaid" : "", checked("ins_medicare") ? "Medicare" : "", checked("ins_other") ? text("insurance_other") || "Other" : ""].filter(Boolean);
  add("health.healthInsurancePlan", insurance.join(", "));

  for (const [keys, serviceType] of SERVICE_TYPES) if (keys.some(checked)) add(`services.types.${serviceType}`, "true");
  add("services.0.startDate", text("requested_start_date"));
  const requested = parseRequestedHours(text("requested_hours"));
  add("services.0.authorizedHours", requested?.hours); add("services.0.authorizationPeriod", requested?.period);

  // "Contact for service needs" is a contact person, not necessarily a legal representative, so it lands as an emergency-contact proposal.
  if (checked("call_other")) { add("emergencyContacts.0.name", text("other_contact_name")); add("emergencyContacts.0.relationship", text("other_contact_relationship")); add("emergencyContacts.0.phone", phoneFromText(text("other_contact_phone"))); }

  // Referring person: a professional contact. With no separate case manager block it is the case manager (the usual case); otherwise it is kept as its own contact.
  const hasCaseManager = ["case_manager_name", "case_manager_agency", "case_manager_phone", "case_manager_email"].some(key => text(key));
  if (hasCaseManager) {
    add("caseManager.name", text("case_manager_name")); add("caseManager.agency", text("case_manager_agency"));
    add("caseManager.phone", phoneFromText(text("case_manager_phone"))); add("caseManager.email", emailFromText(text("case_manager_email")));
  }
  if (text("referral_name") && !(hasCaseManager && text("referral_name").toLowerCase() === text("case_manager_name").toLowerCase())) {
    const group = hasCaseManager ? "referrer" : "caseManager";
    add(`${group}.name`, text("referral_name")); add(`${group}.agency`, text("referral_agency")); add(`${group}.phone`, phoneFromText(text("referral_phone"))); add(`${group}.email`, emailFromText(text("referral_email")));
  }

  // Everything else on the form lands in the care profile for the reviewer to confirm.
  care("specialInstructions", "Special instructions", text("special_instructions"));
  care("bestTimeToCall", "Best time to call", text("best_time_to_call"));
  care("serviceLocation", "Service location", checked("place_home") ? "Home" : checked("place_other") ? "Other" : "");
  care("referralDate", "Referral date", text("todays_date"));
  const heard = [["heard_website", "Website"], ["heard_case_manager", "Case manager"], ["heard_physician", "Physician"], ["heard_hospital", "Hospital"], ["heard_previous_client", "Previous client"], ["heard_family_member", "Family member"], ["heard_brochure", "Brochure"]].filter(([key]) => checked(key)).map(([, label]) => label);
  if (checked("heard_other")) heard.push(text("heard_other_text") || "Other");
  care("referralSource", "How they heard about Radiant Care", heard.join(", "));
  const otherServices = [["svc_icls", "ICLS"], ["svc_sils", "SILS"], ["svc_companion", "Companion"], ["svc_emergency", "Emergency"], ["svc_employment_exploration", "Employment exploration"]].filter(([key]) => checked(key)).map(([, label]) => label);
  if (checked("svc_other")) otherServices.push(text("svc_other_text") || "Other");
  care("otherServicesRequested", "Other services requested", otherServices.join(", "));
  return out.map(item => item.fieldPath.startsWith("services.types.") ? { fieldPath: item.fieldPath, value: true } : item);
}

/**
 * The fillable form's own boxes are authoritative. Its printed wording (footer email, section headings, thank-you line) must never become client data,
 * so text-derived proposals on these paths are dropped for a recognized referral form.
 */
export const REFERRAL_FORM_FIELD_OWNED_PREFIXES = ["client.", "caseManager.", "health.", "services.", "emergencyContacts."];
export const referralFormOwnsPath = (fieldPath: string) => REFERRAL_FORM_FIELD_OWNED_PREFIXES.some(prefix => fieldPath.startsWith(prefix));
