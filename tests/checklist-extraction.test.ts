import { describe, expect, it } from "vitest";
import { extractChecklistProposals, extractDocumentFactProposals, careKey } from "@/domain/clients/extraction/checklist";
import type { TextLine } from "@/domain/clients/extraction/semantic";

// Synthetic assessment layout: label column at x0 .053, assessment column at x0 .439. No real client data.
const line = (text: string, y: number, x = 0.053): TextLine => ({ text, box: { x0: x, y0: y, x1: x + 0.5, y1: y + 0.015 } });
const page: TextLine[] = [
  line("Allergies (state specific  Yes  No  There are no allergies reported at this time.", 0.68),
  line("allergies):  NA – there are no allergies", 0.70),
  line("Seizures (state specific seizure  Yes  No", 0.74),
  line("types):  NA – no seizures", 0.76),
  line("Choking  Yes  No", 0.79),
  line("Chronic medical conditions  Yes  No  Reported diagnoses are managed with the guardian,", 0.84),
  line("(state condition): TBI, post-  NA – there are no chronic  and migraine. Staff support symptom management.", 0.86),
  line("concussion syndrome, MMR,  medical conditions", 0.88),
  line("agitation, migraine", 0.90),
  line("Water safety skills  Yes  No  Person has water safety skills. In the event assistance is", 1.00),
  line("needed, staff will assist.", 1.02, 0.439),
  line("Other health and medical  Yes  No  NA", 1.06),
  line("needs (state specific need):", 1.08),
  line("Personal safety to avoid injury or accident in the service setting", 1.16),
  line("Community survival skills  Yes  No  Guardian reported the person needs an escort.", 1.20),
];
const byPath = (items: ReturnType<typeof extractChecklistProposals>) => Object.fromEntries(items.map(item => [item.fieldPath, item]));

describe("assessment checklist rows", () => {
  const items = extractChecklistProposals([page], "NATIVE_TEXT");
  const found = byPath(items);

  it("maps rows that match an existing health field to that field's text", () => {
    expect(found["health.allergiesReactions"].value).toBe("There are no allergies reported at this time.");
    expect(found["health.diagnoses"].value).toBe("TBI, post-concussion syndrome, MMR, agitation, migraine");
  });

  it("creates a care item with the answer left blank when nothing existing fits or there is no typed text", () => {
    for (const key of ["care.seizures", "care.choking", "care.waterSafetySkills", "care.communitySurvivalSkills"]) {
      expect(found[key], key).toBeDefined();
      expect((found[key].value as Record<string, string>).answer).toBe("");
    }
    expect((found["care.waterSafetySkills"].value as Record<string, string>).note).toContain("staff will assist");
    expect((found["care.waterSafetySkills"].value as Record<string, string>).label).toBe("Water safety skills");
  });

  it("never guesses the answer from checkbox marks and skips blank template slots and headings", () => {
    expect(items.some(item => JSON.stringify(item.value).includes('"answer":"YES"') || JSON.stringify(item.value).includes('"answer":"NO"'))).toBe(false);
    expect(Object.keys(found).some(key => /other/i.test(key))).toBe(false);
    expect(Object.keys(found).some(key => /personalSafety/i.test(key))).toBe(false);
  });

  it("records the source row and a moderate confidence", () => {
    expect(found["care.seizures"].sourceLocation).toContain("Page 1");
    expect(found["care.seizures"].confidence).toBeGreaterThan(0.5);
    expect(found["care.seizures"].confidence).toBeLessThan(0.75);
  });

  it("tolerates OCR checkbox noise between the options", () => {
    const noisy = extractChecklistProposals([[{ text: "Water safety skills L] Yes LJ No Person can swim." }]], "LOCAL_OCR");
    expect(noisy.map(item => item.fieldPath)).toEqual(["care.waterSafetySkills"]);
  });

  it("builds stable camel-case keys", () => {
    expect(careKey("Community survival skills")).toBe("communitySurvivalSkills");
    expect(careKey("Self-administration of medication")).toBe("selfAdministrationOfMedication");
  });
});

describe("document facts", () => {
  it("reads assessment dates, the annual period and who completed the review", () => {
    const facts = Object.fromEntries(extractDocumentFactProposals([[
      { text: "Date of Self-Management Assessment development:7/2/2021  For the annual period from: 7/1/2022-7/1/2023" },
      { text: "Name and title of person completing the review: Pat Staff, Designated Coordinator" },
      { text: "Plan review and update: 06/7/2022  Expiration date: 7/1/2024" },
    ]], "NATIVE_TEXT").map(item => [item.fieldPath, item.value]));
    expect(facts).toEqual({
      "document.creationDate": "7/2/2021",
      "document.effectiveDate": "7/1/2022",
      "document.periodEnd": "7/1/2023",
      "document.completedBy": "Pat Staff, Designated Coordinator",
      "document.reviewDate": "06/7/2022",
      "document.expirationDate": "7/1/2024",
    });
  });

  it("reads the plan-addendum wording too", () => {
    const facts = Object.fromEntries(extractDocumentFactProposals([[
      { text: "Date of development: 7/1/2021 For the annual period from: 7/1/2021 to 7/1/2023" },
    ]], "LOCAL_OCR").map(item => [item.fieldPath, item.value]));
    expect(facts["document.creationDate"]).toBe("7/1/2021");
    expect(facts["document.periodEnd"]).toBe("7/1/2023");
  });

  it("does not invent expiration from an annual-period end",()=>{const facts=Object.fromEntries(extractDocumentFactProposals([[{text:"For the annual period from: 7/1/2022 to 7/1/2023"}]],"NATIVE_TEXT").map(item=>[item.fieldPath,item.value]));expect(facts["document.effectiveDate"]).toBe("7/1/2022");expect(facts["document.periodEnd"]).toBe("7/1/2023");expect(facts["document.expirationDate"]).toBeUndefined()});
});
