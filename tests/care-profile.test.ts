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
