import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSignatureRequirements, validateManagementSignerSelections } from "@/domain/clients/signature-requirements";

const client = {
  legalFirstName: "Synthetic",
  legalLastName: "Person",
  email: "person@example.test",
  representatives: [],
  contacts: [],
};

describe("structured signature requirement policies", () => {
  it("derives current intake methods per signer requirement", () => {
    const requirements = buildSignatureRequirements(
      {
        signerRoles: ["CLIENT", "RADIANT_CARE_STAFF", "DESIGNATED_COORDINATOR_OR_MANAGER"],
      },
      client,
    );
    expect(requirements.map((row) => row.allowedMethods)).toEqual([["SIGN_NOW", "SEND_FOR_SIGNATURE"], ["SIGN_NOW"], ["SIGN_NOW", "SEND_FOR_SIGNATURE"]]);
    expect(requirements[0].candidates[0]).toMatchObject({ name: "Synthetic Person", email: "person@example.test" });
    expect(requirements[1].candidates[0]).toMatchObject({ name: "", email: null });
  });

  it("honors an explicit template-level method override", () => {
    const [requirement] = buildSignatureRequirements(
      {
        signerRoles: ["ORGANIZATION_STAFF"],
        signerMethods: {
          ORGANIZATION_STAFF: ["SIGN_NOW", "SEND_FOR_SIGNATURE"],
        },
      },
      client,
    );
    expect(requirement.allowedMethods).toEqual(["SIGN_NOW", "SEND_FOR_SIGNATURE"]);
  });

  it("prefills authenticated staff without substituting that identity for an ineligible role", () => {
    const staff = { name: "Authorized Administrator", email: "admin@example.test", designatedCoordinatorOrManager: false };
    const [organizationStaff, coordinator] = buildSignatureRequirements(
      { signerRoles: ["ORGANIZATION_STAFF", "DESIGNATED_COORDINATOR_OR_MANAGER"] },
      client,
      staff,
    );
    expect(organizationStaff.candidates[0]).toMatchObject({ name: "Authorized Administrator", email: "admin@example.test", source: "AUTHENTICATED_STAFF" });
    expect(coordinator.candidates[0]).toMatchObject({ name: "", email: null, source: "MANUAL_STAFF" });
    expect(() => validateManagementSignerSelections([coordinator], [{ role: "ORGANIZATION_STAFF", name: "" }], { allowPendingIdentity: true })).not.toThrow();
    expect(() => validateManagementSignerSelections([coordinator], [{ role: "ORGANIZATION_STAFF", name: "Confirmed Coordinator" }], { allowManualIdentity: true })).not.toThrow();
  });

  it("keeps managed delivery signer-scoped and supports invitation-only revocation", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/clients/signatures.ts"), "utf8");
    expect(source).toContain("startManagedSignerAction");
    expect(source).toContain("sendSignatureInvitation");
    expect(source).toContain("client.signature_invitation_revoked");
    expect(source).toContain('data:{status:"PENDING",sentAt:null,verificationMethod:null}');
  });
});
