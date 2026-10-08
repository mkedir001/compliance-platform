import { describe, expect, it } from "vitest";
import { projectSignatureProgress } from "@/domain/clients/signature-progress";

const pending = { required: true, status: "SENT", signedAt: null, signatureMethod: null, verificationMethod: "SECURE_INVITATION" };
const signed = { required: true, status: "SIGNED", signedAt: new Date("2026-10-08T12:00:00Z"), signatureMethod: "TYPED", verificationMethod: "SECURE_INVITATION" };

describe("authoritative signature progress projection", () => {
  it("reports zero, partial, and complete required-signature progress", () => {
    expect(projectSignatureProgress([pending, pending])).toMatchObject({ completed: 0, pending: 2, total: 2 });
    expect(projectSignatureProgress([signed, pending])).toMatchObject({ completed: 1, pending: 1, total: 2 });
    expect(projectSignatureProgress([signed, signed])).toMatchObject({ completed: 2, pending: 0, total: 2 });
  });

  it("does not count status-only, invalid, or optional rows as completed evidence", () => {
    const statusOnly = { ...signed, signedAt: null };
    expect(projectSignatureProgress([statusOnly, { ...signed, required: false }])).toMatchObject({ completed: 0, total: 1 });
    expect(projectSignatureProgress([{ ...signed, evidenceValid: false }])).toMatchObject({ completed: 0, total: 1 });
  });
});
