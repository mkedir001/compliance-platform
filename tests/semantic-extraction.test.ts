import { describe, expect, it } from "vitest";
import { buildNativeLines, buildOcrLines, extractSemanticFields, flattenText, linesFromFlatText, splitTextLines } from "@/domain/clients/extraction/semantic";

// All names, numbers, and addresses below are synthetic. Never add real client documents here.
const page = (text: string) => [splitTextLines(text).map(line => ({ text: line }))];
const flat = (text: string) => linesFromFlatText([flattenText(text)]);
const byPath = (fields: ReturnType<typeof extractSemanticFields>) => Object.fromEntries(fields.map(field => [field.fieldPath, field.value]));

describe("semantic client field extraction", () => {
  it.each([
    "Name of person served: Jordan Example",
    "Client name: Jordan Example",
    "Individual needing help: Jordan Example",
    "Recipient: Jordan Example\nDate of birth: 03/08/1990",
    "Name of individual receiving services - Jordan Example",
    "Participant name: Jordan Example",
    "Clients name: Jordan Example",
  ])("maps different wording for the client name to one canonical field: %s", label => {
    const values = byPath(extractSemanticFields(page(label), "NATIVE_TEXT"));
    expect(values["identity.fullName"]).toBe("Jordan Example");
    expect(values["client.legalFirstName"]).toBe("Jordan");
    expect(values["client.legalLastName"]).toBe("Example");
  });

  it("handles Last, First names", () => {
    const values = byPath(extractSemanticFields(page("Client name: Example, Jordan"), "NATIVE_TEXT"));
    expect(values["client.legalFirstName"]).toBe("Jordan");
    expect(values["client.legalLastName"]).toBe("Example");
  });

  it("reads several labelled values that were flattened onto one line without exact lookahead matches", () => {
    const text = `Radiant Care COORDINATED SERVICE AND SUPPORT PLAN (CSSP) ADDENDUM Name of person served: Jordan Example Date of development: 7/1/2021 For the annual period from: 7/1/2021 to 7/1/2023 Name and title of person completing the CSSP Addendum: Pat Staff, Designated Coordinator Legal representative: Sam Guardian Case manager: Alex Manager Dates of development: Within 15 calendar days`;
    const values = byPath(extractSemanticFields(flat(text), "LOCAL_OCR"));
    expect(values["identity.fullName"]).toBe("Jordan Example");
    expect(values["representatives.0.name"]).toBe("Sam Guardian");
    expect(values["caseManager.name"]).toBe("Alex Manager");
    // The person completing the plan is staff, never the client.
    expect(Object.values(values)).not.toContain("Pat Staff");
  });

  it("accepts a comma after the label and keeps contact details with the right role", () => {
    const values = byPath(extractSemanticFields(page(`Client receives case management services. Case manager, Alex Manager
Case manager phone: 612-555-0100
Case manager email: alex.manager@example.org
Phone: 651-555-0111`), "NATIVE_TEXT"));
    expect(values["caseManager.name"]).toBe("Alex Manager");
    expect(values["caseManager.phone"]).toBe("612-555-0100");
    expect(values["caseManager.email"]).toBe("alex.manager@example.org");
  });

  it("inherits the role of a nearby section label for bare phone and email lines", () => {
    const values = byPath(extractSemanticFields(page(`Legal representative: Sam Guardian
Phone: (651) 555-0123
Email: sam@example.org`), "NATIVE_TEXT"));
    expect(values["representatives.0.name"]).toBe("Sam Guardian");
    expect(values["representatives.0.phone"]).toBe("(651) 555-0123");
    expect(values["representatives.0.email"]).toBe("sam@example.org");
    expect(values["client.phone"]).toBeUndefined();
  });

  it("reads the value from the next line when the label line has none", () => {
    const fields = extractSemanticFields(page(`Name of person served:
Jordan Example`), "NATIVE_TEXT");
    const name = fields.find(field => field.fieldPath === "identity.fullName");
    expect(name?.value).toBe("Jordan Example");
    expect(name!.confidence).toBeLessThan(1);
  });

  it("tolerates small OCR errors in labels with lower confidence", () => {
    const exact = extractSemanticFields(page("Person served: Jordan Example"), "LOCAL_OCR").find(f => f.fieldPath === "identity.fullName")!;
    const typo = extractSemanticFields(page("Persan served: Jordan Example"), "LOCAL_OCR").find(f => f.fieldPath === "identity.fullName")!;
    expect(typo.value).toBe("Jordan Example");
    expect(typo.confidence).toBeLessThan(exact.confidence);
  });

  it("validates values and rejects text that is not a date, phone, or name", () => {
    const values = byPath(extractSemanticFields(page(`Date of birth: unknown
Phone: not available
Client name: 12345`), "NATIVE_TEXT"));
    expect(values["client.dateOfBirth"]).toBeUndefined();
    expect(values["client.phone"]).toBeUndefined();
    expect(values["identity.fullName"]).toBeUndefined();
  });

  it("extracts dates and demographics when labelled", () => {
    const values = byPath(extractSemanticFields(page(`Date of birth: 03/08/1990   Gender: Female
Home address: 123 Example Street
City: Exampleville State: MN Zip: 55125
MA/PMI number: 12345678
Primary language: English`), "NATIVE_TEXT"));
    expect(values["client.dateOfBirth"]).toBe("03/08/1990");
    expect(values["client.addressLine1"]).toBe("123 Example Street");
    expect(values["client.city"]).toBe("Exampleville");
    expect(values["client.state"]).toBe("MN");
    expect(values["client.postalCode"]).toBe("55125");
    expect(values["client.primaryLanguage"]).toBe("English");
  });

  it("does not invent fields from narrative sentences", () => {
    const fields = extractSemanticFields(page("The client receives individualized home supports three days per week, with assistance focused on community participation."), "NATIVE_TEXT");
    expect(fields).toEqual([]);
  });

  it("does not treat a generic individual label as client identity without supporting context",()=>{
    expect(extractSemanticFields(page("Individual: Jordan Example"),"NATIVE_TEXT")).toEqual([]);
  });

  it("records the page, line, label, and confidence for review", () => {
    const [field] = extractSemanticFields(page("Name of person served: Jordan Example"), "NATIVE_TEXT").filter(f => f.fieldPath === "identity.fullName");
    expect(field.page).toBe(1);
    expect(field.line).toBe(1);
    expect(field.label).toBe("Name of person served");
    expect(field.confidence).toBeGreaterThan(0.9);
    expect(field.sourceLocation).toContain("Page 1 line 1");
  });

  it("groups positioned PDF.js items into lines left to right, top to bottom, with boxes", () => {
    const item = (str: string, x: number, y: number, width = 40) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
    const lines = buildNativeLines([item("Jordan Example", 150, 700, 70), item("Name of person served:", 20, 700, 110), item("Date of birth: 03/08/1990", 20, 680, 120)]);
    expect(lines.map(line => line.text)).toEqual(["Name of person served:  Jordan Example", "Date of birth: 03/08/1990"]);
    expect(lines[0].box!.x0).toBe(20);
    const values = byPath(extractSemanticFields([lines], "NATIVE_TEXT"));
    expect(values["identity.fullName"]).toBe("Jordan Example");
    expect(values["client.dateOfBirth"]).toBe("03/08/1990");
  });

  it("accepts a bare Name label only near the top of the first page, with lower confidence", () => {
    const top = extractSemanticFields(page("Name: Jordan Example\nDate of birth: 03/08/1990"), "NATIVE_TEXT").find(f => f.fieldPath === "identity.fullName");
    expect(top?.value).toBe("Jordan Example");
    expect(top!.confidence).toBeLessThan(0.7);
    const later = extractSemanticFields(page("Case manager: Alex Manager\nName: Pat Other"), "NATIVE_TEXT").find(f => f.fieldPath === "identity.fullName");
    expect(later).toBeUndefined();
  });

  it("rejects handwriting-style OCR garbage and prose as values", () => {
    const fields = extractSemanticFields(page("Name of person served: aJ0rDaN eXamPle ~~\nPhone: l23 4S6\nI understand that my information may be released to the person named below."), "LOCAL_OCR");
    expect(fields.find(f => f.fieldPath === "client.phone")).toBeUndefined();
    expect(fields.find(f => f.value.includes("understand"))).toBeUndefined();
  });

  it("parses Tesseract TSV into normalized boxes and uses OCR quality in confidence",()=>{
    const header="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
    const tsv=[header,"1\t1\t0\t0\t0\t0\t0\t0\t1000\t1200\t-1\t","5\t1\t1\t1\t1\t1\t100\t120\t100\t30\t92\tClient","5\t1\t1\t1\t1\t2\t210\t120\t90\t30\t91\tname:","5\t1\t1\t1\t1\t3\t330\t120\t100\t30\t88\tJordan","5\t1\t1\t1\t1\t4\t440\t120\t120\t30\t90\tExample"].join("\n");
    const lines=buildOcrLines(tsv),field=extractSemanticFields([lines],"LOCAL_OCR").find(item=>item.fieldPath==="identity.fullName");
    expect(lines).toEqual([expect.objectContaining({text:"Client name: Jordan Example",box:{x0:.1,y0:.1,x1:.56,y1:.125}})]);
    expect(field).toMatchObject({value:"Jordan Example",box:{x0:.1,y0:.1,x1:.56,y1:.125}});
    expect(field!.confidence).toBeLessThan(.9);
  });

  it("associates a positioned value directly below its label without crossing columns",()=>{
    const lines=[
      {text:"Name of person served:",box:{x0:.05,y0:.1,x1:.35,y1:.13}},
      {text:"Unrelated Narrative",box:{x0:.62,y0:.14,x1:.9,y1:.17}},
      {text:"Jordan Example",box:{x0:.05,y0:.15,x1:.25,y1:.18}},
    ];
    expect(byPath(extractSemanticFields([lines],"NATIVE_TEXT"))["identity.fullName"]).toBe("Jordan Example");
  });

  it("retains distinct competing values for human conflict review",()=>{
    const fields=extractSemanticFields(page("Client name: Jordan Example\nClient name: Morgan Example"),"NATIVE_TEXT").filter(item=>item.fieldPath==="identity.fullName");
    expect(fields.map(item=>item.value)).toEqual(["Jordan Example","Morgan Example"]);
  });

  it("maps supported service and health destinations but not unsupported narrative concepts",()=>{
    const values=byPath(extractSemanticFields(page(`Service type: Individualized Home Supports
Authorized hours: 12.5
Authorization number: AUTH-204
Primary care clinic: Example Clinic
Pharmacy phone: 651-555-0199
Diagnoses: Synthetic condition
Personal outcome: Wants more community activities`),"NATIVE_TEXT"));
    expect(values).toMatchObject({"services.0.serviceType":"Individualized Home Supports","services.0.authorizedHours":"12.5","services.0.authorizationIdentifier":"AUTH-204","health.clinic":"Example Clinic","health.pharmacyPhone":"651-555-0199","health.diagnoses":"Synthetic condition"});
    expect(Object.values(values)).not.toContain("Wants more community activities");
  });

  it("has zero false positives and false negatives on the synthetic ground-truth corpus",()=>{
    const corpus=[
      {
        lines:`Person served: Jordan Example\nDate of birth: 03/08/1990\nLegal representative: Sam Guardian\nCase manager: Alex Manager`,
        expected:["identity.fullName=Jordan Example","client.legalFirstName=Jordan","client.legalLastName=Example","client.dateOfBirth=03/08/1990","representatives.0.name=Sam Guardian","caseManager.name=Alex Manager"],
      },
      {
        lines:`Client name: Morgan Sample\nPhone: 651-555-0188\nEmail: morgan.sample@example.org\nHome address: 42 Sample Avenue`,
        expected:["identity.fullName=Morgan Sample","client.legalFirstName=Morgan","client.legalLastName=Sample","client.phone=651-555-0188","client.email=morgan.sample@example.org","client.addressLine1=42 Sample Avenue"],
      },
      {
        lines:"The individual receives support from a case manager and may call a provider when needed.",
        expected:[],
      },
    ];
    const actual=corpus.flatMap(item=>extractSemanticFields(page(item.lines),"NATIVE_TEXT").map(field=>`${field.fieldPath}=${field.value}`));
    const expected=corpus.flatMap(item=>item.expected);
    const falsePositives=actual.filter(item=>!expected.includes(item));
    const falseNegatives=expected.filter(item=>!actual.includes(item));
    expect({falsePositives,falseNegatives}).toEqual({falsePositives:[],falseNegatives:[]});
  });
});
