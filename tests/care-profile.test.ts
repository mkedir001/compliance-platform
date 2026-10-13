import { describe, expect, it } from "vitest";
import { buildCareProfile } from "@/domain/clients/care-profile";

const fact = (key: string, answer: string, extra: Record<string, string> = {}) => ({
  fieldPath: `care.${key}`, value: { label: "Water safety skills", answer, detail: "", note: "", ...extra },
  sourceLocation: "Page 3", confidence: 0.68, reviewedByUserId: "user-1", reviewedAt: "2026-10-13T18:00:00.000Z",
});
const document = (id: string, completed: string, facts: unknown[], status = "COMPLETED") => ({
  id, originalFileName: `${id}.pdf`, status, authoritativeCompletedAt: completed, snapshotJson: { reviewedFacts: facts },
});

describe("care profile", () => {
  it("lists accepted answers with the document each came from", () => {
    const [item] = buildCareProfile([document("sma-2022", "2022-06-07T12:00:00Z", [fact("waterSafetySkills", "YES", { detail: "With staff nearby" })])]);
    expect(item.label).toBe("Water safety skills");
    expect(item.current).toMatchObject({ answer: "YES", detail: "With staff nearby", documentId: "sma-2022", documentName: "sma-2022.pdf" });
    expect(item.earlier).toEqual([]);
  });

  it("makes the newest document's answer current and keeps the earlier one", () => {
    const [item] = buildCareProfile([
      document("old", "2021-07-02T12:00:00Z", [fact("waterSafetySkills", "NO")]),
      document("new", "2022-07-01T12:00:00Z", [fact("waterSafetySkills", "YES")]),
    ]);
    expect(item.current).toMatchObject({ answer: "YES", documentId: "new" });
    expect(item.earlier.map(entry => [entry.documentId, entry.answer])).toEqual([["old", "NO"]]);
  });

  it("ignores unanswered items, voided documents, and facts that are not care items", () => {
    const items = buildCareProfile([
      document("a", "2022-01-01T00:00:00Z", [fact("waterSafetySkills", ""), { fieldPath: "health.diagnoses", value: "TBI" }, { fieldPath: "document.periodEnd", value: "7/1/2023" }]),
      document("b", "2022-01-01T00:00:00Z", [fact("canSwim", "NO", { label: "Can swim" })], "VOIDED"),
      { id: "c", snapshotJson: null },
    ]);
    expect(items).toEqual([]);
  });

  it("sorts by label and falls back to a readable label from the key", () => {
    const items = buildCareProfile([document("a", "2022-01-01T00:00:00Z", [
      { ...fact("riskOfFalling", "NA"), value: { answer: "NA", detail: "", note: "" } },
      fact("communitySurvivalSkills", "YES", { label: "Community survival skills" }),
    ])]);
    expect(items.map(item => item.label)).toEqual(["Community survival skills", "Risk of falling"]);
  });
});

describe("care profile ordering and conflicts", () => {
  const withPeriod = (id: string, periodStart: string, answer: string, uploaded: string, completed: string | null = null) => ({
    id, originalFileName: `${id}.pdf`, status: "DRAFT", authoritativeCompletedAt: completed, importedAt: uploaded,
    snapshotJson: { reviewedFacts: [fact("waterSafetySkills", answer), { fieldPath: "document.periodStart", value: periodStart }] },
  });

  it("orders by the document's own dates, not by upload time", () => {
    const [item] = buildCareProfile([
      withPeriod("sma-2022", "7/1/2022", "YES", "2026-01-01T00:00:00Z"),
      withPeriod("sma-2021", "7/1/2021", "NO", "2026-09-01T00:00:00Z"), // uploaded later but older
    ]);
    expect(item.current.documentId).toBe("sma-2022");
    expect(item.earlier[0].documentId).toBe("sma-2021");
    expect(item.ambiguous).toBe(false);
  });

  it("prefers the reviewer-confirmed completion date over dates found in the document", () => {
    const [item] = buildCareProfile([
      withPeriod("a", "7/1/2022", "YES", "2026-01-01T00:00:00Z", "2021-01-01T00:00:00Z"),
      withPeriod("b", "7/1/2021", "NO", "2026-01-01T00:00:00Z", "2023-01-01T00:00:00Z"),
    ]);
    expect(item.current.documentId).toBe("b");
  });

  it("flags disagreement between documents that cannot be ordered", () => {
    const [item] = buildCareProfile([
      withPeriod("a", "7/1/2022", "YES", "2026-01-01T00:00:00Z"),
      withPeriod("b", "7/1/2022", "NO", "2026-02-01T00:00:00Z"),
    ]);
    expect(item.ambiguous).toBe(true);
  });

  it("does not flag same-date documents that agree", () => {
    const [item] = buildCareProfile([withPeriod("a", "7/1/2022", "YES", "2026-01-01T00:00:00Z"), withPeriod("b", "7/1/2022", "YES", "2026-02-01T00:00:00Z")]);
    expect(item.ambiguous).toBe(false);
  });
});
