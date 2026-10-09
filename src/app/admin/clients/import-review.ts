const exactLabels: Record<string, string> = {
  "client.legalFirstName": "Legal first name",
  "client.legalLastName": "Legal last name",
  "client.preferredName": "Preferred name",
  "client.dateOfBirth": "Date of birth",
  "client.gender": "Gender / identity",
  "client.phone": "Phone",
  "client.email": "Email",
  "client.addressLine1": "Street address",
  "client.city": "City",
  "client.state": "State",
  "client.postalCode": "ZIP / postal code",
  "client.maPmiNumber": "MA / PMI number",
  "client.waiverProgram": "Waiver / funding program",
  "client.financialResponsibility": "County / tribe of financial responsibility",
  "client.primaryLanguage": "Primary language",
  "client.interpreterNeeded": "Interpreter needed",
  "client.preferredCommunication": "Preferred way to communicate",
  "client.livingSituation": "Living situation",
  "client.strengthsInterests": "Strengths and interests",
  "client.culturalPractices": "Cultural, religious, or personal practices",
  "client.supportNeeds": "Support needs",
  "identity.fullName": "Person served name",
  "caseManager.name": "Case manager name",
  "caseManager.agency": "Case manager agency / county",
  "caseManager.phone": "Case manager phone",
  "caseManager.email": "Case manager email",
  "services.0.authorizationIdentifier": "Service authorization identifier",
  "rights.writtenCopyReceivedDate": "Written copy received date",
  "rights.rightsExplainedDate": "Rights explained date",
  "rights.annualReviewDate": "Annual rights review date",
  "rights.clientDate": "Person served signature date",
  "rights.legalRepresentativeDate": "Legal representative signature date",
  "rights.staffDate": "Organization staff signature date",
  "roi.direction": "Authorization direction",
  "roi.recipientName": "ROI recipient person or agency",
  "roi.relationshipRole": "ROI recipient relationship / role",
  "roi.address": "ROI recipient address",
  "roi.phone": "ROI recipient phone",
  "roi.faxEmail": "ROI recipient fax / email",
  "roi.limitations": "Limits on information sharing",
  "roi.expirationDate": "ROI expiration date",
  "roi.effectiveDate": "ROI effective date",
};

const segmentLabels: Record<string, string> = {
  name: "Name", relationship: "Relationship", phone: "Phone", alternatePhone: "Alternate phone",
  informationSharingAllowed: "Information sharing allowed", medication: "Medication", dose: "Dose",
  times: "Times", reason: "Reason", prescriber: "Prescriber", startDate: "Service start date",
  serviceType: "Service type", representativeType: "Representative type", email: "Email",
  primaryCareProvider: "Primary care provider", clinic: "Clinic", providerPhone: "Provider phone",
  dentist: "Dentist", pharmacy: "Pharmacy", pharmacyPhone: "Pharmacy phone",
  healthInsurancePlan: "Health insurance / health plan", memberId: "Member ID",
  diagnoses: "Diagnoses / health conditions", allergiesReactions: "Allergies / reactions",
  specialDietTexture: "Special diet / texture", chokingSwallowingRisk: "Choking / swallowing risk",
  seizureProtocol: "Seizure protocol", mobilityEquipment: "Mobility / adaptive equipment",
  otherHealthNeeds: "Other health needs, treatments, or protocols",
};

const title = (value: string) => { const words=value.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," "),normalized=words===words.toUpperCase()?words.toLowerCase():words;return normalized.replace(/^./,character=>character.toUpperCase()) };

export function clientImportFieldLabel(fieldPath: string) {
  if (exactLabels[fieldPath]) return exactLabels[fieldPath];
  const parts = fieldPath.split("."), leaf = segmentLabels[parts.at(-1) ?? ""] ?? title(parts.at(-1) ?? fieldPath);
  if (parts[0] === "emergencyContacts" && /^\d+$/.test(parts[1] ?? "")) return `Emergency contact ${Number(parts[1]) + 1} — ${leaf.toLowerCase()}`;
  if (parts[0] === "medications" && /^\d+$/.test(parts[1] ?? "")) return `Medication ${Number(parts[1]) + 1} — ${leaf.toLowerCase()}`;
  if (parts[0] === "representatives" && /^\d+$/.test(parts[1] ?? "")) return `Legal representative ${Number(parts[1]) + 1} — ${leaf.toLowerCase()}`;
  if (parts[0] === "services" && parts[1] === "types") return `Service — ${title(parts.slice(2).join(" "))}`;
  if (parts[0] === "roi" && parts[1] === "categories") return `ROI information category — ${title(parts.slice(2).join(" "))}`;
  if (parts[0] === "roi" && parts[1] === "purposes") return `ROI purpose — ${title(parts.slice(2).join(" "))}`;
  if (parts[0] === "externalSignatures") return `${title(parts[1] ?? "Signer")} apparent external signature — ${title(parts[2] ?? "evidence").toLowerCase()}`;
  if (parts[0] === "health") return leaf;
  return `${title(parts[0])} — ${leaf.toLowerCase()}`;
}

export function clientImportReviewState(state: string) {
  const labels: Record<string, string> = {
    PROPOSED: "Proposed",
    CORROBORATED: "Corroborated",
    CONFLICT: "Conflict — review required",
    ACCEPTED: "Accepted",
    CORRECTED: "Corrected",
    REJECTED: "Ignored",
  };
  return labels[state] ?? title(state);
}

export const clientImportProposalNeedsReview = (state: string) => ["PROPOSED", "CORROBORATED", "CONFLICT"].includes(state);
