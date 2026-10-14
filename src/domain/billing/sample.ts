import type { BillingRun, BillingVisit } from "./evv";

/**
 * PREVIEW ONLY. Delete this file when live data is connected (see WIRING notes in src/app/admin/billing/billing-portal.tsx).
 * Clearly labelled sample visits for previewing the Billing screen before the AxisCare feed is connected.
 * Deterministic: the same client ids and date always give the same data. Never use this as billing input.
 */
export function sampleBillingData(clientIds: readonly string[], now = new Date()): { visits: BillingVisit[]; runs: BillingRun[] } {
  const visits: BillingVisit[] = [], runs: BillingRun[] = [];
  const caregivers = ["Alice Tavner", "Jordan Reyes", "Sam Okafor"];
  const services = [{ code: "HOMEMAKING", description: "Homemaking", procedureCode: "S5130" }, { code: "RESPITE", description: "In-home respite", procedureCode: "S5150" }];
  clientIds.forEach((clientId, clientIndex) => {
    const rate = 2400 + (clientIndex % 3) * 150;
    for (let day = 41; day >= 1; day--) {
      if ((day + clientIndex) % 3 === 0) continue;
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day, 14 + (day % 3), 0));
      const hours = 2 + ((day + clientIndex) % 3);
      const end = new Date(start.getTime() + hours * 3600_000);
      const flaw = (day * 7 + clientIndex * 5) % 11;
      const location = { latitude: "44.9537", longitude: "-93.0900" };
      visits.push({
        id: `s=${clientIndex + 1}:d=${start.toISOString().slice(0, 10)}`,
        clientId,
        caregiverName: caregivers[(day + clientIndex) % caregivers.length],
        scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
        clockIn: { time: start.toISOString(), method: flaw === 4 ? "Web" : "Mobile", coordinates: flaw === 4 ? null : location },
        clockOut: flaw === 8 ? { time: null, method: null, coordinates: null } : { time: end.toISOString(), method: flaw === 4 ? "Web" : "Mobile", coordinates: flaw === 4 ? null : location },
        service: services[(day + clientIndex) % services.length],
        hourlyRateCents: rate,
        verified: flaw !== 4,
        modificationReason: flaw === 4 ? "Caregiver forgot to clock in" : null,
        // everything older than 21 days was billed already
        billedRunId: day > 21 && flaw !== 4 && flaw !== 8 ? `sample-run-${clientIndex + 1}` : null,
      });
    }
    const billedMinutes = visits.filter(visit => visit.clientId === clientId && visit.billedRunId).reduce((sum, visit) => sum + Math.round((new Date(visit.clockOut!.time!).getTime() - new Date(visit.clockIn!.time!).getTime()) / 60000), 0);
    runs.push({ id: `sample-run-${clientIndex + 1}`, clientId, billedAt: new Date(now.getTime() - 20 * 86400_000).toISOString(), hours: billedMinutes / 60, amountCents: Math.round((billedMinutes * rate) / 60) });
  });
  return { visits, runs };
}
