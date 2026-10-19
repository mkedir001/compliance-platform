import { describe, expect, it } from "vitest";
import { emailFromText, isReferralFormFields, parseRequestedHours, phoneFromText, referralFormOwnsPath, referralFormProposals, splitAddress, splitFullName } from "@/domain/clients/referral-form-fields";

const raw = {
  client_name: "Jordan Example", client_dob: "4/16/2005", client_male: true, client_phone: "Pat-507-555-0101", client_email: "Pat Example; pat@example.com",
  service_address: "100 MAIN ST NW Springfield MN 55000", medicaid_number: "01234567", waiver_program: "DD waiver", svc_ihs: true, svc_ihs_with_training: true,
  svc_respite: true, svc_respite_in_home: true, svc_other: true, requested_start_date: "9/28/26", call_other: true,
  other_contact_name: "Pat Example", other_contact_relationship: "guardian/mom", other_contact_phone: "507-555-0101"
};
const get = (items: ReturnType<typeof referralFormProposals>, path: string) => items.find(item => item.fieldPath === path)?.value;

describe("referral form field mapping", () => {
  it("maps the form's own field names to client import paths", () => {
    const items = referralFormProposals(raw);
    expect(get(items, "client.legalFirstName")).toBe("Jordan"); expect(get(items, "client.legalLastName")).toBe("Example");
    expect(get(items, "client.dateOfBirth")).toBe("4/16/2005"); expect(get(items, "client.gender")).toBe("Male");
    expect(get(items, "client.maPmiNumber")).toBe("01234567"); expect(get(items, "client.waiverProgram")).toBe("DD waiver");
    expect(get(items, "services.0.startDate")).toBe("9/28/26");
    expect(get(items, "services.types.IHS_WITH_TRAINING")).toBe(true); expect(get(items, "services.types.RESPITE")).toBe(true); expect(get(items, "services.types.OTHER")).toBe(true);
    expect(get(items, "services.types.IHS_WITHOUT_TRAINING")).toBeUndefined();
    expect(get(items, "emergencyContacts.0.relationship")).toBe("guardian/mom");
  });
  it("cleans phone, email, name and address text", () => {
    const items = referralFormProposals(raw);
    expect(get(items, "client.phone")).toBe("507-555-0101"); expect(get(items, "client.email")).toBe("pat@example.com");
    expect(get(items, "client.addressLine1")).toBe("100 MAIN ST NW"); expect(get(items, "client.city")).toBe("Springfield"); expect(get(items, "client.state")).toBe("MN"); expect(get(items, "client.postalCode")).toBe("55000");
    expect(splitFullName("Example, Jordan")).toEqual({ first: "Jordan", last: "Example" }); expect(splitFullName("Cher")).toBeNull();
    expect(splitAddress("12 Oak Ave, Austin, MN 55912")).toEqual({ addressLine1: "12 Oak Ave", city: "Austin", state: "MN", postalCode: "55912" });
    expect(splitAddress("somewhere unclear")).toEqual({ addressLine1: "somewhere unclear" });
    expect(phoneFromText("no number")).toBeNull(); expect(emailFromText("none")).toBeNull();
  });
  it("only proposes what is present and recognizes the form by its field names", () => {
    expect(referralFormProposals({ client_name: "Jordan Example" }).map(item => item.fieldPath)).toEqual(["client.legalFirstName", "client.legalLastName"]);
    expect(isReferralFormFields(["client_name", "client_dob", "svc_ihs"])).toBe(true);
    expect(isReferralFormFields(["FACE_001_Legal_first_name"])).toBe(false);
  });
});

describe("referral form: Saint cities, requested hours, diagnosis and insurance", () => {
  it("keeps St. Paul and other multi-word cities together", () => {
    expect(splitAddress("395 Luella Street N Apt #302 St. Paul, MN 55119")).toEqual({ addressLine1: "395 Luella Street N Apt #302", city: "St. Paul", state: "MN", postalCode: "55119" });
    expect(splitAddress("395 Luella Street N Apt #302 St. Paul MN 55119")).toMatchObject({ addressLine1: "395 Luella Street N Apt #302", city: "St. Paul" });
    expect(splitAddress("12 Oak Ave Saint Paul MN 55104")).toMatchObject({ addressLine1: "12 Oak Ave", city: "Saint Paul" });
    expect(splitAddress("700 Main St South St. Paul MN 55075")).toMatchObject({ addressLine1: "700 Main St", city: "South St. Paul" });
    expect(splitAddress("5000 Excelsior Blvd St. Louis Park MN 55416")).toMatchObject({ addressLine1: "5000 Excelsior Blvd", city: "St. Louis Park" });
    expect(splitAddress("22 Elm St St. Cloud MN 56301")).toMatchObject({ addressLine1: "22 Elm St", city: "St. Cloud" });
    expect(splitAddress("9 Bass Lake Rd Brooklyn Park MN 55428")).toMatchObject({ addressLine1: "9 Bass Lake Rd", city: "Brooklyn Park" });
    expect(splitAddress("1 Pine St Eden Prairie MN 55344")).toMatchObject({ addressLine1: "1 Pine St", city: "Eden Prairie" });
  });
  it("splits requested hours into the hours and its period", () => {
    expect(parseRequestedHours("16 hours daily")).toEqual({ hours: "16", period: "daily" });
    expect(parseRequestedHours("40 hrs/week")).toEqual({ hours: "40", period: "weekly" });
    expect(parseRequestedHours("8 hours per day")).toEqual({ hours: "8", period: "daily" });
    expect(parseRequestedHours("12.5 hours a month")).toEqual({ hours: "12.5", period: "monthly" });
    expect(parseRequestedHours("20")).toEqual({ hours: "20", period: null });
    expect(parseRequestedHours("as needed")).toBeNull();
  });
  it("maps the real referral form's values", () => {
    const items = referralFormProposals({ client_name: "Jennifer Jaques", service_address: "395 Luella Street N Apt #302 St. Paul, MN 55119", primary_diagnosis: "M50.20", medicaid_number: "00504177", requested_hours: "16 hours daily", ins_medicaid: true, ins_medicare: true, ins_other: true, insurance_other: "Blue Plus" });
    expect(get(items, "client.city")).toBe("St. Paul"); expect(get(items, "client.addressLine1")).toBe("395 Luella Street N Apt #302");
    expect(get(items, "health.diagnoses")).toBe("M50.20");
    expect(get(items, "services.0.authorizedHours")).toBe("16"); expect(get(items, "services.0.authorizationPeriod")).toBe("daily");
    expect(get(items, "health.healthInsurancePlan")).toBe("Medicaid, Medicare, Blue Plus");
    expect(get(items, "client.maPmiNumber")).toBe("00504177");
  });
  it("treats printed template wording on a recognized form as non-client data", () => {
    expect(referralFormOwnsPath("client.email")).toBe(true); expect(referralFormOwnsPath("health.diagnoses")).toBe(true); expect(referralFormOwnsPath("caseManager.agency")).toBe(true);
    expect(referralFormOwnsPath("care.waterSafetySkills")).toBe(false);
  });
});
