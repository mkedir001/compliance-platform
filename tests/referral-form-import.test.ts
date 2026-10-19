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

describe("referral form: care profile items, Medicare, overnight and the referring person", () => {
  const full = {
    client_name: "Jennifer Jaques", medicaid_number: "00504177", medicare_number: "1EG4-TE5-MK73",
    svc_night_supervision: true, svc_icls: true, svc_other: true, svc_other_text: "Transportation",
    special_instructions: "Call before arriving; dog in the home", best_time_to_call: "Anytime", place_home: true, todays_date: "9/16/2026",
    heard_case_manager: true, heard_other: true, heard_other_text: "Client",
    referral_name: "Sam Rivera", referral_agency: "Ramsey County", referral_phone: "Sam 651-555-0100", referral_email: "sam@ramsey.example",
  };
  const careValue = (items: ReturnType<typeof referralFormProposals>, key: string) => items.find(item => item.fieldPath === `care.${key}`)?.value as { label: string; answer: string; detail: string } | undefined;

  it("keeps the MA number and stores the Medicare number separately", () => {
    const items = referralFormProposals(full);
    expect(get(items, "client.maPmiNumber")).toBe("00504177");
    expect(get(items, "health.medicareNumber")).toBe("1EG4-TE5-MK73");
  });
  it("maps night supervision to overnight sleep and keeps the other services as OTHER", () => {
    const items = referralFormProposals(full);
    expect(get(items, "services.types.OVERNIGHT_SLEEP")).toBe(true);
    expect(get(items, "services.types.OTHER")).toBe(true);
  });
  it("records the remaining form entries as care profile items with the text as detail", () => {
    const items = referralFormProposals(full);
    expect(careValue(items, "specialInstructions")).toEqual({ label: "Special instructions", answer: "YES", detail: "Call before arriving; dog in the home", note: "" });
    expect(careValue(items, "bestTimeToCall")?.detail).toBe("Anytime");
    expect(careValue(items, "serviceLocation")?.detail).toBe("Home");
    expect(careValue(items, "referralDate")?.detail).toBe("9/16/2026");
    expect(careValue(items, "referralSource")?.detail).toBe("Case manager, Client");
    expect(careValue(items, "otherServicesRequested")?.detail).toBe("ICLS, Transportation");
    expect(referralFormProposals({ client_name: "Jennifer Jaques" }).some(item => item.fieldPath.startsWith("care."))).toBe(false);
  });
  it("treats the referring person as the case manager unless the form names a different case manager", () => {
    const asCaseManager = referralFormProposals(full);
    expect(get(asCaseManager, "caseManager.name")).toBe("Sam Rivera"); expect(get(asCaseManager, "caseManager.agency")).toBe("Ramsey County");
    expect(get(asCaseManager, "caseManager.phone")).toBe("651-555-0100"); expect(get(asCaseManager, "caseManager.email")).toBe("sam@ramsey.example");
    expect(get(asCaseManager, "referrer.name")).toBeUndefined();
    const separate = referralFormProposals({ ...full, case_manager_name: "Alex Reese" });
    expect(get(separate, "referrer.name")).toBe("Sam Rivera"); expect(get(separate, "caseManager.name")).toBeUndefined();
    const sameName = referralFormProposals({ ...full, case_manager_name: "sam rivera" });
    expect(get(sameName, "referrer.name")).toBeUndefined();
  });
});
