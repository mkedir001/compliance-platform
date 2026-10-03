import type { Prisma } from "@prisma/client";
import { ValidationError } from "@/domain/auth/errors";

export type SignatureCandidate = { role: string; name: string; email: string | null; source: "CLIENT" | "REPRESENTATIVE" | "PROFESSIONAL_CONTACT" | "MANUAL_STAFF" };
export type SigningMethod = "SIGN_NOW" | "SEND_FOR_SIGNATURE";
export type SignatureRequirement = { key: string; label: string; allowedRoles: string[]; allowedMethods: SigningMethod[]; candidates: SignatureCandidate[] };
type ClientSigningContext = {
  legalFirstName: string;
  legalLastName: string;
  preferredName?: string | null;
  email?: string | null;
  representatives: { name: string; email: string | null }[];
  contacts: { role: string; professionalContact: { name: string; email: string | null } }[];
};

const clientCandidate = (client: ClientSigningContext): SignatureCandidate => ({ role: "CLIENT", name: `${client.legalFirstName} ${client.legalLastName}`, email: client.email ?? null, source: "CLIENT" });
const representativeCandidates = (client: ClientSigningContext): SignatureCandidate[] => client.representatives.map(row => ({ role: "LEGAL_REPRESENTATIVE", name: row.name, email: row.email, source: "REPRESENTATIVE" }));
const caseManagerCandidates = (client: ClientSigningContext): SignatureCandidate[] => client.contacts.filter(row => row.role === "CASE_MANAGER").map(row => ({ role: "CASE_MANAGER", name: row.professionalContact.name, email: row.professionalContact.email, source: "PROFESSIONAL_CONTACT" }));

export function buildSignatureRequirements(content: Prisma.JsonValue, client: ClientSigningContext): SignatureRequirement[] {
  const configuration = content as { signerRoles?: string[]; signerMethods?: Record<string, SigningMethod[]> } | null, roles = configuration?.signerRoles ?? [];
  return roles.flatMap((configured, index): SignatureRequirement[] => {
    const key = `${index}:${configured}`, allowedMethods = configuration?.signerMethods?.[configured] ?? (["RADIANT_CARE_STAFF", "ORGANIZATION_STAFF"].includes(configured) ? ["SIGN_NOW"] : ["SIGN_NOW", "SEND_FOR_SIGNATURE"]);
    if (configured === "CLIENT_OR_LEGAL_REPRESENTATIVE") return [{ key, label: "Person served or legal representative", allowedRoles: ["CLIENT", "LEGAL_REPRESENTATIVE"], allowedMethods, candidates: [clientCandidate(client), ...representativeCandidates(client)] }];
    if (configured === "LEGAL_REPRESENTATIVE_IF_APPLICABLE") return client.representatives.length ? [{ key, label: "Legal representative", allowedRoles: ["LEGAL_REPRESENTATIVE"], allowedMethods, candidates: representativeCandidates(client) }] : [];
    if (["RADIANT_CARE_STAFF", "DESIGNATED_COORDINATOR_OR_MANAGER", "ORGANIZATION_STAFF"].includes(configured)) return [{ key, label: configured === "DESIGNATED_COORDINATOR_OR_MANAGER" ? "Designated coordinator or manager" : "Organization staff", allowedRoles: ["ORGANIZATION_STAFF"], allowedMethods, candidates: [{ role: "ORGANIZATION_STAFF", name: "", email: null, source: "MANUAL_STAFF" }] }];
    if (configured === "CLIENT") return [{ key, label: "Person served", allowedRoles: ["CLIENT"], allowedMethods, candidates: [clientCandidate(client)] }];
    if (configured === "LEGAL_REPRESENTATIVE") return [{ key, label: "Legal representative", allowedRoles: ["LEGAL_REPRESENTATIVE"], allowedMethods, candidates: representativeCandidates(client) }];
    if (configured === "CASE_MANAGER") return [{ key, label: "Case manager", allowedRoles: ["CASE_MANAGER"], allowedMethods, candidates: caseManagerCandidates(client) }];
    return [{ key, label: configured.replaceAll("_", " ").toLowerCase(), allowedRoles: [configured], allowedMethods, candidates: [] }];
  });
}

export function validateManagementSignerSelections(requirements: SignatureRequirement[], signers: { role: string; name: string }[]) {
  if (!requirements.length) throw new ValidationError("This document template has no configured signer roles");
  if (signers.length !== requirements.length) throw new ValidationError("Confirm exactly one signer for every required signer role");
  const unmatched = [...signers];
  for (const requirement of requirements) {
    const index = unmatched.findIndex(signer => requirement.allowedRoles.includes(signer.role) && (signer.role === "ORGANIZATION_STAFF" || requirement.candidates.some(candidate => candidate.role === signer.role && candidate.name === signer.name)));
    if (index < 0) throw new ValidationError(`Confirm the intended ${requirement.label} from canonical client/contact information`);
    unmatched.splice(index, 1);
  }
}
