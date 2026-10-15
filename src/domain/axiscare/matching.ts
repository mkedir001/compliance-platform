export type WaldahClientIdentity = { id: string; legalFirstName: string; legalLastName: string; preferredName: string | null; dateOfBirth: Date | null; maPmiNumber: string | null; axisCareClientId: string | null };
export type AxisCareClientIdentity = { externalId: string | null; firstName: string | null; lastName: string | null; goesBy: string | null; dateOfBirth: string | null; medicaidNumber: string | null };
export type MatchProposal = { clientId: string; kind: "AUTO" | "SUGGEST"; score: number; reason: string };

const norm = (v: string | null | undefined) => (v ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const dob = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null;

/**
 * Auto-link only when first name, last name AND date of birth match exactly and exactly one Waldah client does.
 * Anything weaker is a suggestion that a person must confirm.
 */
export function proposeMatches(axis: AxisCareClientIdentity, clients: WaldahClientIdentity[]): MatchProposal[] {
  const first = norm(axis.firstName), last = norm(axis.lastName), axisDob = axis.dateOfBirth?.slice(0, 10) ?? null, goes = norm(axis.goesBy);
  const out: MatchProposal[] = [];
  for (const client of clients) {
    if (client.axisCareClientId && client.axisCareClientId !== axis.externalId) continue;
    const cFirst = norm(client.legalFirstName), cLast = norm(client.legalLastName), cPref = norm(client.preferredName), sameDob = !!axisDob && dob(client.dateOfBirth) === axisDob;
    const sameLast = !!last && cLast === last, sameFirst = !!first && (cFirst === first || cPref === first || (!!goes && (cFirst === goes || cPref === goes)));
    const sameMedicaid = !!axis.medicaidNumber && axis.medicaidNumber === client.maPmiNumber;
    if (cFirst === first && sameLast && sameDob) out.push({ clientId: client.id, kind: "AUTO", score: 100, reason: "Name and date of birth match exactly" });
    else if (sameMedicaid && sameLast) out.push({ clientId: client.id, kind: "SUGGEST", score: 90, reason: "Medicaid number and last name match" });
    else if (sameLast && sameFirst && !axisDob) out.push({ clientId: client.id, kind: "SUGGEST", score: 60, reason: "Name matches; AxisCare has no date of birth" });
    else if (sameLast && sameFirst) out.push({ clientId: client.id, kind: "SUGGEST", score: 55, reason: "Name matches but date of birth differs" });
    else if (sameDob && sameLast) out.push({ clientId: client.id, kind: "SUGGEST", score: 70, reason: "Last name and date of birth match; first name differs" });
    else if (sameDob && sameFirst) out.push({ clientId: client.id, kind: "SUGGEST", score: 65, reason: "First name and date of birth match; last name differs" });
  }
  out.sort((a, b) => b.score - a.score);
  const autos = out.filter(m => m.kind === "AUTO");
  // An exact match that is not unique is ambiguous, so it becomes a suggestion for a person to settle.
  if (autos.length > 1) return out.map(m => m.kind === "AUTO" ? { ...m, kind: "SUGGEST", score: 95, reason: "Several Waldah clients match exactly; confirm which one" } : m);
  return out.slice(0, 5);
}
