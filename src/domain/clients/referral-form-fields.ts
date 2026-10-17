/**
 * Maps the fillable Radiant Care "Services Referral Form" (AcroForm field names such as client_name,
 * client_dob, svc_ihs_with_training) onto the client import proposal paths. Pure functions, no I/O.
 * The referrals module keeps its own mapping for the referral workflow; this one feeds the client import.
 */
export type ReferralFormProposal = { fieldPath: string; value: string | boolean };
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

/** "1203 8TH ST NW Austin MN 55912" or "1203 8th St NW, Austin, MN 55912". Falls back to the whole text as the street line. */
export function splitAddress(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const tail = /^(.*?)[,\s]+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(text);
  if (!tail) return { addressLine1: text };
  const head = tail[1], state = tail[2].toUpperCase(), postalCode = tail[3];
  if (head.includes(",")) { const index = head.lastIndexOf(","); const street = head.slice(0, index).trim(), city = head.slice(index + 1).trim(); return street && city ? { addressLine1: street, city, state, postalCode } : { addressLine1: text }; }
  const words = head.split(" ");
  return words.length < 3 ? { addressLine1: text } : { addressLine1: words.slice(0, -1).join(" "), city: words.at(-1)!, state, postalCode };
}

/** Service boxes → Waldah service types. Services without a Waldah equivalent become OTHER (the reviewer sees it and can correct). */
const SERVICE_TYPES: [string[], string][] = [
  [["svc_ihs_without_training"], "IHS_WITHOUT_TRAINING"], [["svc_ihs_with_training"], "IHS_WITH_TRAINING"], [["svc_ihs_family_training"], "IHS_WITH_FAMILY_TRAINING"],
  [["svc_respite_in_home", "svc_respite_out_of_home"], "RESPITE"], [["svc_homemaker"], "HOMEMAKING"],
  [["svc_icls", "svc_night_supervision", "svc_sils", "svc_companion", "svc_emergency", "svc_employment_exploration", "svc_other"], "OTHER"]
];

export function referralFormProposals(raw: Raw): ReferralFormProposal[] {
  const out: ReferralFormProposal[] = [], text = (key: string) => typeof raw[key] === "string" ? (raw[key] as string).trim() : "", checked = (key: string) => raw[key] === true || raw[key] === "Yes";
  const add = (fieldPath: string, value: string | null | undefined) => { if (value) out.push({ fieldPath, value }); };

  const name = splitFullName(text("client_name"));
  add("client.legalFirstName", name?.first); add("client.legalLastName", name?.last);
  add("client.dateOfBirth", text("client_dob"));
  add("client.gender", checked("client_male") ? "Male" : checked("client_female") ? "Female" : null);
  add("client.phone", phoneFromText(text("client_phone"))); add("client.email", emailFromText(text("client_email")));
  const address = splitAddress(text("service_address"));
  if (address) for (const [key, value] of Object.entries(address)) add(`client.${key}`, value);
  add("client.maPmiNumber", text("medicaid_number")); add("client.waiverProgram", text("waiver_program"));

  for (const [keys, serviceType] of SERVICE_TYPES) if (keys.some(checked)) add(`services.types.${serviceType}`, "true");
  add("services.0.startDate", text("requested_start_date"));

  // "Contact for service needs" is a contact person, not necessarily a legal representative, so it lands as an emergency-contact proposal.
  if (checked("call_other")) { add("emergencyContacts.0.name", text("other_contact_name")); add("emergencyContacts.0.relationship", text("other_contact_relationship")); add("emergencyContacts.0.phone", phoneFromText(text("other_contact_phone"))); }
  return out.map(item => item.fieldPath.startsWith("services.types.") ? { fieldPath: item.fieldPath, value: true } : item);
}
