export const intakeSteps = [
  { id: "CLIENT", label: "Person" },
  { id: "SERVICES", label: "Services" },
  { id: "REPRESENTATIVE", label: "Legal representative" },
  { id: "CASE_MANAGER", label: "Case manager" },
  { id: "EMERGENCY_CONTACTS", label: "Emergency contacts" },
  { id: "HEALTH", label: "Health" },
  { id: "MEDICATIONS", label: "Medications" },
  { id: "ABOUT_PERSON", label: "Person-centered" },
  { id: "RIGHTS", label: "Rights" },
  { id: "ROI", label: "Release of information" },
  { id: "DOCUMENTS", label: "Review & documents" },
] as const;

export type IntakeStepId = (typeof intakeSteps)[number]["id"];
export type IntakeSectionState = "UNVISITED" | "INCOMPLETE" | "COMPLETE";

export const livingSituationOptions = [
  { value: "OWN_HOME_APARTMENT", label: "Own home/apartment" },
  { value: "FAMILY_HOME", label: "Family home" },
  { value: "OTHER", label: "Other" },
] as const;

export const serviceTypeOptions = [
  { value: "IHS_WITH_TRAINING", label: "IHS with training" },
  { value: "IHS_WITHOUT_TRAINING", label: "IHS without training" },
  { value: "IHS_WITH_FAMILY_TRAINING", label: "IHS with family training" },
  { value: "RESPITE", label: "Respite" },
  { value: "HOMEMAKING", label: "Homemaking" },
  { value: "OVERNIGHT_SLEEP", label: "Overnight sleep" },
  { value: "OVERNIGHT_AWAKE", label: "Overnight awake" },
] as const;

export const authorizationPeriodOptions = ["daily", "weekly", "monthly", "yearly"] as const;

export const representativeTypeOptions = [
  { value: "GUARDIAN", label: "Guardian" },
  { value: "CONSERVATOR", label: "Conservator" },
  { value: "HEALTH_CARE_AGENT_POA", label: "Health care agent / POA" },
  { value: "PARENT_OF_MINOR", label: "Parent of minor" },
] as const;

export const medicationResponsibilityOptions = [
  { value: "PERSON_MANAGES", label: "Person manages own medications" },
  { value: "FAMILY_OTHER_MANAGES", label: "Family / other manages" },
  { value: "RADIANT_CARE_ASSISTS", label: "Radiant Care assists (complete Form 05)" },
  { value: "RADIANT_CARE_ADMINISTERS", label: "Radiant Care administers (complete Form 05)" },
] as const;

type IntakeEvaluationSource = {
  legalFirstName?: string | null;
  legalLastName?: string | null;
  dateOfBirth?: Date | string | null;
  livingSituation?: string | null;
  strengthsInterests?: string | null;
  culturalPractices?: string | null;
  supportNeeds?: string | null;
  services?: Array<{ serviceType?: string | null; startDate?: Date | string | null; authorizedHours?: unknown; authorizationStart?: Date | string | null; authorizationEnd?: Date | string | null; scheduleJson?: unknown }>;
  representatives?: Array<{ representativeType?: string | null; name?: string | null }>;
  emergencyContacts?: Array<{ name?: string | null; relationship?: string | null; phone?: string | null }>;
  healthProfile?: { medicationResponsibility?: string | null } | null;
  medications?: Array<{ medication?: string | null }>;
  contacts?: Array<{ role?: string | null }>;
  intakeStatus?: string | null;
  progressJson?: unknown;
};

export type IntakeBlocker = { step: IntakeStepId; label: string; messages: string[] };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function present(value: unknown) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function validDate(value: unknown) { const parsed = value ? new Date(String(value)) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null; }

function normalizedLivingSituation(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replaceAll(/[\s/-]+/g, "_");
  if (["OWN_HOME_APARTMENT", "OWN_HOME_OR_APARTMENT", "OWN_HOME", "OWN_APARTMENT"].includes(normalized)) return "OWN_HOME_APARTMENT";
  if (normalized === "FAMILY_HOME") return "FAMILY_HOME";
  if (normalized === "OTHER" || normalized.startsWith("OTHER_")) return "OTHER";
  return "";
}

function servicePeriod(service: { scheduleJson?: unknown }) {
  const period = object(service.scheduleJson).authorizationPeriod;
  return authorizationPeriodOptions.includes(period as (typeof authorizationPeriodOptions)[number]) ? period : null;
}

function progress(source: IntakeEvaluationSource) {
  const value = object(source.progressJson);
  const visited = Array.isArray(value.visitedSections)
    ? value.visitedSections.filter((item): item is IntakeStepId => intakeSteps.some(step => step.id === item))
    : Array.isArray(value.completedSections)
      ? value.completedSections.filter((item): item is IntakeStepId => intakeSteps.some(step => step.id === item))
      : [];
  return { value, visited: new Set<IntakeStepId>(visited), answers: object(value.documentAnswers) };
}

export function evaluateIntake(source: IntakeEvaluationSource) {
  const saved = progress(source), rights = object(saved.answers.rights), roi = object(saved.answers.roi);
  const issues = intakeSteps.reduce((result, step) => ({ ...result, [step.id]: [] }), {} as Record<IntakeStepId, string[]>);
  if (!present(source.legalFirstName)) issues.CLIENT.push("Legal first name is required.");
  if (!present(source.legalLastName)) issues.CLIENT.push("Legal last name is required.");
  if (!source.dateOfBirth) issues.CLIENT.push("Date of birth is required.");
  if (!normalizedLivingSituation(source.livingSituation)) issues.CLIENT.push("Select one of the Face Sheet living-situation options.");

  if (!source.services?.length) issues.SERVICES.push("Add at least one service.");
  source.services?.forEach((service, index) => {
    const number = index + 1;
    if (!serviceTypeOptions.some(option => option.value === service.serviceType)) issues.SERVICES.push(`Service ${number}: select an approved service type.`);
    if (!service.startDate) issues.SERVICES.push(`Service ${number}: service start date is required.`);
    if (service.authorizedHours === null || service.authorizedHours === undefined || String(service.authorizedHours) === "") issues.SERVICES.push(`Service ${number}: authorized-hour quantity is required.`);
    if (!servicePeriod(service)) issues.SERVICES.push(`Service ${number}: authorized-hour period is required.`);
    if (!service.authorizationStart) issues.SERVICES.push(`Service ${number}: authorization start date is required.`);
    if (!service.authorizationEnd) issues.SERVICES.push(`Service ${number}: authorization end date is required.`);
    const authorizationStart=validDate(service.authorizationStart),authorizationEnd=validDate(service.authorizationEnd);
    if(authorizationStart&&authorizationEnd&&authorizationEnd<authorizationStart)issues.SERVICES.push(`Service ${number}: authorization end date cannot be before its start date.`);
  });

  source.representatives?.forEach((representative, index) => {
    if (!present(representative.name) || !representativeTypeOptions.some(option => option.value === representative.representativeType)) issues.REPRESENTATIVE.push(`Representative ${index + 1}: name and representative type are required.`);
  });
  if (!source.contacts?.some(contact => contact.role === "CASE_MANAGER")) issues.CASE_MANAGER.push("Select a case manager.");
  if (!source.emergencyContacts?.length) issues.EMERGENCY_CONTACTS.push("Add at least one emergency contact.");
  source.emergencyContacts?.forEach((contact, index) => {
    if (![contact.name, contact.relationship, contact.phone].every(present)) issues.EMERGENCY_CONTACTS.push(`Emergency contact ${index + 1}: name, relationship, and phone are required.`);
  });
  if (!medicationResponsibilityOptions.some(option => option.value === source.healthProfile?.medicationResponsibility)) issues.HEALTH.push("Select the medication-responsibility option that applies.");
  source.medications?.forEach((medication, index) => { if (!present(medication.medication)) issues.MEDICATIONS.push(`Medication ${index + 1}: medication name is required.`); });
  if (![source.strengthsInterests, source.culturalPractices, source.supportNeeds].every(present)) issues.ABOUT_PERSON.push("Complete all three person-centered narrative fields, or return later if they are not yet available.");
  if (!rights.writtenCopyReceivedDate) issues.RIGHTS.push("Written-copy received date is required.");
  if (!rights.rightsExplainedDate) issues.RIGHTS.push("Rights-explained date is required.");
  if (!rights.explanationMethod) issues.RIGHTS.push("Rights explanation method is required.");
  if (rights.explanationMethod === "OTHER" && !rights.explanationNotes) issues.RIGHTS.push("Describe the other rights-explanation method.");
  if (!roi.recipientName) issues.ROI.push("ROI recipient is required.");
  if (!Array.isArray(roi.categories) || !roi.categories.length) issues.ROI.push("Select at least one ROI information category.");
  if (!Array.isArray(roi.purposes) || !roi.purposes.length) issues.ROI.push("Select at least one ROI purpose.");
  if (!roi.effectiveDate) issues.ROI.push("ROI effective date is required.");
  if (!roi.expirationDate && !roi.expirationEvent) issues.ROI.push("ROI expiration date or event is required.");
  if (Array.isArray(roi.categories) && roi.categories.includes("OTHER") && !roi.otherCategory) issues.ROI.push("Describe the other ROI information category.");
  if (Array.isArray(roi.purposes) && roi.purposes.includes("OTHER") && !roi.otherPurpose) issues.ROI.push("Describe the other ROI purpose.");
  const effectiveDate=validDate(roi.effectiveDate),expirationDate=validDate(roi.expirationDate);
  if(effectiveDate&&expirationDate){const maximum=new Date(effectiveDate);maximum.setFullYear(maximum.getFullYear()+1);if(expirationDate<=effectiveDate||expirationDate>maximum)issues.ROI.push("ROI expiration must be after the effective date and no more than one year later.");}
  if (source.intakeStatus !== "COMPLETED") issues.DOCUMENTS.push("Complete the intake review before leaving the guided workflow.");

  const sectionStates = Object.fromEntries(intakeSteps.map(step => {
    const visited = saved.visited.has(step.id) || step.id === "DOCUMENTS" && source.intakeStatus === "COMPLETED";
    return [step.id, !visited ? "UNVISITED" : issues[step.id].length ? "INCOMPLETE" : "COMPLETE"];
  })) as Record<IntakeStepId, IntakeSectionState>;
  const completionRequired = new Set<IntakeStepId>(["CLIENT", "SERVICES", "REPRESENTATIVE", "CASE_MANAGER", "EMERGENCY_CONTACTS", "HEALTH", "MEDICATIONS", "RIGHTS", "ROI"]);
  const blockers = intakeSteps.filter(step => completionRequired.has(step.id) && (!saved.visited.has(step.id) || issues[step.id].length)).map(step => ({
    step: step.id,
    label: step.label,
    messages: !saved.visited.has(step.id) ? ["Visit and save this section.", ...issues[step.id]] : issues[step.id],
  }));
  return { visitedSections: [...saved.visited], sectionStates, blockers, issues };
}

export function serviceTypeLabel(value: unknown) {
  return serviceTypeOptions.find(option => option.value === value)?.label ?? String(value ?? "");
}

export function livingSituationValue(value: unknown) {
  return normalizedLivingSituation(value);
}
