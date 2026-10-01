import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ClientDocumentType, Prisma } from "@prisma/client";

type Layout = Record<string, Record<string, { page: number; type: string; rect: [number, number, number, number] }>>;
type JsonObject = Record<string, unknown>;

const assetFiles: Record<ClientDocumentType, string> = {
  INTAKE_CHECKLIST: "00_Intake_Checklist_Staff_Use.pdf",
  FACE_SHEET: "01_Client_Information_Face_Sheet.pdf",
  RIGHTS_ACKNOWLEDGMENT: "02_Service_Recipient_Rights_Acknowledgment.pdf",
  ROI: "04_Authorization_to_Release_Information.pdf",
};
const assetRoot = join(process.cwd(), "reference", "intake-forms", "templates");

export const radiantCareTemplateAssets = assetFiles;

export async function renderRadiantCareTemplate(
  type: ClientDocumentType,
  snapshot: Prisma.InputJsonValue,
  status: "DRAFT" | "FINALIZED",
) {
  const file = assetFiles[type];
  const layouts = JSON.parse(readFileSync(join(assetRoot, "field-layout.json"), "utf8")) as Layout;
  const layout = layouts[file];
  if (!layout || basename(file) !== file) throw new Error("Approved intake template asset is unavailable");
  const pdf = await PDFDocument.load(readFileSync(join(assetRoot, file)));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const values = mapFields(type, asObject(snapshot));
  for (const [field, value] of Object.entries(values)) {
    const target = layout[field];
    if (!target || value === null || value === undefined || value === "" || value === false) continue;
    const page = pdf.getPage(target.page);
    const [x1, y1, x2, y2] = target.rect;
    if (value === true) {
      page.drawText("X", { x: x1 + 2, y: y1 + 1, size: Math.min(10, Math.max(7, y2 - y1 - 2)), font });
      continue;
    }
    drawText(page, String(value), { x: x1 + 2, y: y1 + 2, width: x2 - x1 - 4, height: y2 - y1 - 4 }, font);
  }
  if (status === "DRAFT") for (const page of pdf.getPages()) page.drawText("DRAFT - NOT FINAL", { x: 455, y: 14, size: 8, font, color: rgb(0.72, 0.12, 0.12) });
  return pdf.save();
}

function mapFields(type: ClientDocumentType, snapshot: JsonObject): Record<string, string | boolean | null | undefined> {
  const client = asObject(snapshot.client);
  const form = asObject(snapshot.form);
  if (type === "INTAKE_CHECKLIST") return checklistFields(client, form);
  if (type === "FACE_SHEET") return faceSheetFields(client, form);
  if (type === "RIGHTS_ACKNOWLEDGMENT") return rightsFields(client, form);
  return roiFields(client, asObject(snapshot.roi));
}

function checklistFields(client: JsonObject, form: JsonObject) {
  const service = first(asArray(client.services));
  const intake = first(asArray(client.intakes));
  const items = asArray(intake.checklistItems);
  const item = (code: string) => items.find(row => asObject(row).code === code) as JsonObject | undefined;
  const completed = (code: string) => asObject(item(code)).status === "COMPLETE";
  const completedDate = (code: string) => date(asObject(item(code)).completedAt);
  const pairs: Array<[string, string]> = [
    ["REFERRAL_CASE_MANAGER_RECEIVED", "006"], ["CSSP_ASSESSMENTS_RECEIVED", "008"], ["FUNDING_CONFIRMED", "010"],
    ["FACE_SHEET_COMPLETED", "012"], ["RIGHTS_NOTICE", "014"], ["POLICY_ACKNOWLEDGMENT", "016"], ["ROI_STATUS", "018"],
    ["MEDICATION_AUTHORIZATION_IF_APPLICABLE", "020"], ["FUNDS_PROPERTY_AUTHORIZATION_IF_APPLICABLE", "022"],
    ["PERSON_SPECIFIC_ORIENTATION", "024"], ["PRELIMINARY_SUPPORT_PLAN", "026"], ["SUPPORT_TEAM_MEETING", "028"],
    ["CSSP_ADDENDUM", "030"], ["PROGRESS_REVIEW_SCHEDULE", "032"], ["MAR_STARTED_IF_APPLICABLE", "034"], ["SIGNED_DOCUMENT_RECORD", "036"],
  ];
  const fields: Record<string, string | boolean | null | undefined> = {
    CHK_001_Person_served: fullName(client), CHK_002_Date_of_birth: date(client.dateOfBirth),
    CHK_003_Service_start_date: date(service.startDate), CHK_004_Service_s: asArray(client.services).map(row => text(asObject(row).serviceType)).filter(Boolean).join(", "),
    CHK_005_Intake_completed_by: text(form.intakeCompletedBy), CHK_038_Notes_follow_up_needed: text(form.notesFollowUp),
    CHK_039_pg2_Person_served_name: fullName(client), CHK_040_pg2_Date_of_birth: date(client.dateOfBirth),
    CHK_042_Printed_name_Staff_completing_intake: text(form.staffPrintedName), CHK_043_Date_Staff_completing_intake: date(form.staffCompletedDate),
    CHK_045_Printed_name_Designated_coordinator_mana: text(form.managerPrintedName), CHK_046_Date_Designated_coordinator_manager_revi: date(form.managerReviewDate),
  };
  for (const [code, number] of pairs) {
    const field = Object.keys(layoutNames.INTAKE_CHECKLIST).find(name => name.startsWith(`CHK_${number}_`));
    const dateField = Object.keys(layoutNames.INTAKE_CHECKLIST).find(name => name.startsWith(`CHK_${String(Number(number) + 1).padStart(3, "0")}_`));
    if (field) fields[field] = completed(code);
    if (dateField) fields[dateField] = completedDate(code);
  }
  return fields;
}

function faceSheetFields(client: JsonObject, form: JsonObject) {
  const services = asArray(client.services), service = first(services), representative = first(asArray(client.representatives));
  const contactLink = asArray(client.contacts).find(row => asObject(row).role === "CASE_MANAGER"), caseManager = asObject(asObject(contactLink).professionalContact);
  const emergencies = asArray(client.emergencyContacts), health = asObject(client.healthProfile), medications = asArray(client.medications);
  const fields: Record<string, string | boolean | null | undefined> = {
    FACE_001_Legal_first_name:text(client.legalFirstName),FACE_002_Last_name:text(client.legalLastName),FACE_003_Preferred_name:text(client.preferredName),FACE_004_Date_of_birth:date(client.dateOfBirth),FACE_005_Gender:text(client.gender),FACE_006_Phone:text(client.phone),FACE_007_Email:text(client.email),FACE_008_Street_address:[text(client.addressLine1),text(client.addressLine2)].filter(Boolean).join(" "),FACE_009_City:text(client.city),FACE_010_State:text(client.state),FACE_011_ZIP:text(client.postalCode),FACE_012_MA_PMI_number:text(client.maPmiNumber),FACE_013_Waiver_or_funding_program:text(client.waiverProgram),FACE_014_County_tribe_of_financial_responsibility:text(client.financialResponsibility),FACE_015_Primary_language:text(client.primaryLanguage),FACE_016_Interpreter_needed_yes_no:client.interpreterNeeded?"Yes":"No",FACE_017_Preferred_way_to_communicate:text(client.preferredCommunication),
    FACE_018_Living_situation_Own_home_apartment:contains(client.livingSituation,"own"),FACE_019_Living_situation_Family_home:contains(client.livingSituation,"family"),FACE_020_Living_situation_Other:Boolean(client.livingSituation&&!contains(client.livingSituation,"own")&&!contains(client.livingSituation,"family")),
    FACE_021_Service_s_to_be_provided_Individualized_:services.some(row=>isIhsWithoutTraining(asObject(row).serviceType)),FACE_022_Service_s_to_be_provided_IHS_with_traini:services.some(row=>contains(asObject(row).serviceType,"with training")),FACE_023_Service_s_to_be_provided_other:services.some(row=>!isIhs(asObject(row).serviceType)),FACE_024_Service_s_to_be_provided_other_text:services.filter(row=>!isIhs(asObject(row).serviceType)).map(row=>text(asObject(row).serviceType)).join(", "),FACE_025_Service_start_date:date(service.startDate),FACE_026_Authorized_units_hours:[number(service.authorizedUnits," units"),number(service.authorizedHours," hours")].filter(Boolean).join(" / "),FACE_027_Authorization_dates:[date(service.authorizationStart),date(service.authorizationEnd)].filter(Boolean).join(" - "),FACE_028_Days_times_and_locations_services_will_b:jsonText(service.scheduleJson),
    FACE_029_legal_rep_type_None_person_is_own_guardi:!representative.name,FACE_030_legal_rep_type_Guardian:contains(representative.representativeType,"guardian"),FACE_031_legal_rep_type_Conservator:contains(representative.representativeType,"conservator"),FACE_032_legal_rep_type_Health_care_agent_POA:contains(representative.representativeType,"poa")||contains(representative.representativeType,"health"),FACE_033_legal_rep_type_Parent_of_minor:contains(representative.representativeType,"parent"),FACE_034_Name:text(representative.name),FACE_035_Relationship:text(representative.relationship),FACE_036_Phone:text(representative.phone),FACE_037_Address:jsonText(representative.addressJson),FACE_038_Email:text(representative.email),
    FACE_039_Case_manager_name:text(caseManager.name),FACE_040_Agency_county:text(caseManager.agency),FACE_041_Phone:text(caseManager.phone),FACE_042_Email:text(caseManager.email),FACE_043_Supervisor_name_and_phone:[text(caseManager.supervisorName),text(caseManager.supervisorPhone)].filter(Boolean).join(" - "),FACE_044_pg2_Person_served_name:fullName(client),FACE_045_pg2_Date_of_birth:date(client.dateOfBirth),
    FACE_061_Primary_care_provider:text(health.primaryCareProvider),FACE_062_Clinic:text(health.clinic),FACE_063_Phone:text(health.providerPhone),FACE_064_Dentist:text(health.dentist),FACE_065_Pharmacy:text(health.pharmacy),FACE_066_Pharmacy_phone:text(health.pharmacyPhone),FACE_067_Health_insurance_health_plan:text(health.healthInsurancePlan),FACE_068_Member_ID:text(health.memberId),FACE_069_Diagnoses_health_conditions:text(health.diagnoses),FACE_070_Allergies_medication_food_environmental_:text(health.allergiesReactions),FACE_071_Special_diet_texture:text(health.specialDietTexture),FACE_072_Choking_or_swallowing_risk_describe:text(health.chokingSwallowingRisk),FACE_073_Seizures_type_protocol:text(health.seizureProtocol),FACE_074_Mobility_adaptive_equipment:text(health.mobilityEquipment),
    FACE_100_Medication_responsibility_Person_manages:contains(health.medicationResponsibility,"person"),FACE_101_Medication_responsibility_Family_other_m:contains(health.medicationResponsibility,"family"),FACE_102_Medication_responsibility_Radiant_Care_a:contains(health.medicationResponsibility,"assist"),FACE_103_Medication_responsibility_Radiant_Care_a:contains(health.medicationResponsibility,"administer"),FACE_104_Other_health_needs_treatments_or_protoco:text(health.otherHealthNeeds),
    FACE_105_pg3_Person_served_name:fullName(client),FACE_106_pg3_Date_of_birth:date(client.dateOfBirth),FACE_107_Strengths_interests_and_what_is_importan:text(client.strengthsInterests),FACE_108_Cultural_religious_or_personal_practices:text(client.culturalPractices),FACE_109_Supports_needed_for_safety_communication:text(client.supportNeeds),FACE_111_Printed_name_Person_served_or_legal_repr:text(form.clientOrRepresentativePrintedName),FACE_112_Date_Person_served_or_legal_representati:date(form.clientOrRepresentativeDate),FACE_114_Printed_name_Radiant_Care_staff_completi:text(form.staffPrintedName),FACE_115_Date_Radiant_Care_staff_completing_form:date(form.staffCompletedDate),
  };
  emergencies.slice(0,3).forEach((row,index)=>{const contact=asObject(row),n=index+1;fields[`FACE_${String(46+index*5).padStart(3,"0")}_Name_row${n}`]=text(contact.name);fields[`FACE_${String(47+index*5).padStart(3,"0")}_Relationship_row${n}`]=text(contact.relationship);fields[`FACE_${String(48+index*5).padStart(3,"0")}_Phone_row${n}`]=text(contact.phone);fields[`FACE_${String(49+index*5).padStart(3,"0")}_Alternate_phone_row${n}`]=text(contact.alternatePhone);fields[`FACE_${String(50+index*5).padStart(3,"0")}_May_we_share_info_Y_N_row${n}`]=contact.informationSharingAllowed?"Y":"N"});
  medications.slice(0,5).forEach((row,index)=>{const medication=asObject(row),base=75+index*5,n=index+1;for(const [offset,key,label] of [[0,"medication","Current_medication"],[1,"dose","Dose"],[2,"times","Time_s"],[3,"reason","Reason"],[4,"prescriber","Prescriber"]] as const)fields[`FACE_${String(base+offset).padStart(3,"0")}_${label}_row${n}`]=text(medication[key])});
  return fields;
}

function rightsFields(client: JsonObject, form: JsonObject) { return {
  RIGHTS_001_pg2_Person_served_name:fullName(client),RIGHTS_002_pg2_Date_of_birth:date(client.dateOfBirth),RIGHTS_003_Radiant_Care_contact_for_problems_or_gri:text(form.grievanceContact),RIGHTS_004_Phone_email:text(form.grievancePhoneEmail),RIGHTS_005_I_received_a_written_copy_of_these_right:Boolean(form.writtenCopyReceivedDate),RIGHTS_006_I_received_a_written_copy_of_these_right:date(form.writtenCopyReceivedDate),RIGHTS_007_These_rights_were_explained_to_me_in_a_w:Boolean(form.rightsExplainedDate),RIGHTS_008_These_rights_were_explained_to_me_in_a_w:date(form.rightsExplainedDate),RIGHTS_009_How_rights_were_explained_In_person:form.explanationMethod==="IN_PERSON",RIGHTS_010_How_rights_were_explained_Phone_video:form.explanationMethod==="PHONE_VIDEO",RIGHTS_011_How_rights_were_explained_Interpreter_us:form.explanationMethod==="INTERPRETER",RIGHTS_012_How_rights_were_explained_Easy_read_visu:form.explanationMethod==="EASY_READ_VISUAL",RIGHTS_013_How_rights_were_explained_other:form.explanationMethod==="OTHER",RIGHTS_014_How_rights_were_explained_other_text:text(form.explanationNotes),RIGHTS_015_Annual_review_of_rights_use_for_yearly_r:Boolean(form.annualReviewDate),RIGHTS_016_Annual_review_of_rights_use_for_yearly_r:date(form.annualReviewDate),
  RIGHTS_018_Printed_name_Person_served:text(form.clientPrintedName),RIGHTS_019_Date_Person_served:date(form.clientDate),RIGHTS_021_Printed_name_Legal_representative_if_app:text(form.legalRepresentativePrintedName),RIGHTS_022_Date_Legal_representative_if_applicable:date(form.legalRepresentativeDate),RIGHTS_024_Printed_name_Radiant_Care_staff:text(form.staffPrintedName),RIGHTS_025_Date_Radiant_Care_staff:date(form.staffDate),
}; }

function roiFields(client: JsonObject, roi: JsonObject) { return {
  ROI_001_Name:fullName(client),ROI_002_Date_of_birth:date(client.dateOfBirth),ROI_003_MA_PMI_number:text(client.maPmiNumber),ROI_004_direction_Radiant_Care_may_RELEASE_infor:roi.direction==="RELEASE_TO",ROI_005_direction_Radiant_Care_may_RECEIVE_infor:roi.direction==="RECEIVE_FROM",ROI_006_direction_Both:roi.direction==="BOTH",ROI_007_Name_of_person_or_agency:text(roi.recipientName),ROI_008_Relationship_role:text(roi.relationshipRole),ROI_009_Address:text(roi.address),ROI_010_Phone:text(roi.phone),ROI_011_Fax_email:text(roi.faxEmail),
  ROI_012_info_type_Face_sheet_contact_information:selected(roi.categories,"FACE_SHEET_CONTACT"),ROI_013_info_type_CSSP_and_CSSP_addendum:selected(roi.categories,"CSSP_ADDENDUM"),ROI_014_info_type_Assessments:selected(roi.categories,"ASSESSMENTS"),ROI_015_info_type_Progress_reports:selected(roi.categories,"PROGRESS_REPORTS"),ROI_016_info_type_Medical_health_information:selected(roi.categories,"MEDICAL_HEALTH"),ROI_017_info_type_Medication_information:selected(roi.categories,"MEDICATION"),ROI_018_info_type_Incident_reports:selected(roi.categories,"INCIDENT_REPORTS"),ROI_019_info_type_Behavior_support_information:selected(roi.categories,"BEHAVIOR_SUPPORT"),ROI_020_info_type_Service_schedules_attendance:selected(roi.categories,"SCHEDULES_ATTENDANCE"),ROI_021_info_type_Billing_information:selected(roi.categories,"BILLING"),ROI_022_info_type_other:selected(roi.categories,"OTHER"),ROI_023_info_type_other_text:text(roi.otherCategory),ROI_024_Limits_on_what_may_be_shared_if_any:text(roi.limitations),
  ROI_025_purpose_Coordinate_services:selected(roi.purposes,"SERVICE_COORDINATION"),ROI_026_purpose_Service_planning_team_meetings:selected(roi.purposes,"SERVICE_PLANNING_TEAM_MEETINGS"),ROI_027_purpose_Health_care:selected(roi.purposes,"HEALTH_CARE"),ROI_028_purpose_Billing_funding:selected(roi.purposes,"BILLING_FUNDING"),ROI_029_purpose_Requested_by_person_legal_rep:selected(roi.purposes,"PERSON_REPRESENTATIVE_REQUEST"),ROI_030_purpose_other:selected(roi.purposes,"OTHER"),ROI_031_purpose_other_text:text(roi.otherPurpose),ROI_032_This_authorization_expires_on_date_or_ev:text(roi.expirationEvent)||date(roi.expirationDate),ROI_033_Effective_date:date(roi.effectiveDate),ROI_035_Printed_name_Person_served:text(roi.clientPrintedName),ROI_036_Date_Person_served:date(roi.clientDate),ROI_038_Printed_name_Legal_representative_if_app:text(roi.legalRepresentativePrintedName),ROI_039_Date_Legal_representative_if_applicable:date(roi.legalRepresentativeDate),ROI_040_pg2_Person_served_name:fullName(client),ROI_041_pg2_Date_of_birth:date(client.dateOfBirth),ROI_043_Printed_name_Radiant_Care_staff:text(roi.staffPrintedName),ROI_044_Date_Radiant_Care_staff:date(roi.staffDate),
}; }

function drawText(page: ReturnType<PDFDocument["getPage"]>, value: string, box: { x:number;y:number;width:number;height:number }, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) { const size=Math.max(6,Math.min(9,box.height>25?9:box.height-2));const max=Math.max(8,Math.floor(box.width/(size*.52))),lines=wrap(value,max).slice(0,Math.max(1,Math.floor(box.height/(size+1))));let y=box.y+box.height-size;for(const line of lines){page.drawText(line,{x:box.x,y,size,font,color:rgb(0.05,0.08,0.12)});y-=size+1} }
function wrap(value:string,max:number){const words=value.replace(/\s+/g," ").trim().split(" "),lines:string[]=[];let line="";for(const word of words){if((line+" "+word).trim().length>max&&line){lines.push(line);line=word}else line=(line+" "+word).trim()}if(line)lines.push(line);return lines}
function asObject(value:unknown):JsonObject{return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:{}}
function asArray(value:unknown):unknown[]{return Array.isArray(value)?value:[]}
function first(value:unknown[]):JsonObject{return asObject(value[0])}
function text(value:unknown){return typeof value==="string"?value:""}
function fullName(client:JsonObject){return [text(client.legalFirstName),text(client.legalLastName)].filter(Boolean).join(" ")}
function date(value:unknown){if(!value)return"";const parsed=new Date(String(value));return Number.isNaN(parsed.getTime())?"":new Intl.DateTimeFormat("en-US",{timeZone:"UTC",month:"2-digit",day:"2-digit",year:"numeric"}).format(parsed)}
function contains(value:unknown,needle:string){return text(value).toLowerCase().includes(needle.toLowerCase())}
function isIhs(value:unknown){const normalized=text(value).toLowerCase().replaceAll("_"," ");return normalized.includes("ihs")||normalized.includes("in home support")}
function isIhsWithoutTraining(value:unknown){return isIhs(value)&&!contains(value,"with training")}
function selected(value:unknown,item:string){return asArray(value).includes(item)}
function number(value:unknown,suffix:string){return value===null||value===undefined||value===""?"":`${String(value)}${suffix}`}
function jsonText(value:unknown){if(!value)return"";if(typeof value==="string")return value;return Object.entries(asObject(value)).map(([key,item])=>`${key}: ${Array.isArray(item)?item.join(", "):String(item)}`).join("; ")}

// Field-name sets keep checklist pairing deterministic without coupling runtime behavior to source values.
const layoutNames={INTAKE_CHECKLIST:{
  CHK_006_Referral_and_case_manager_contact_inform:true,CHK_007_Referral_and_case_manager_contact_inform:true,CHK_008_Coordinated_Service_and_Support_Plan_CSS:true,CHK_009_Coordinated_Service_and_Support_Plan_CSS:true,CHK_010_Service_authorization_funding_confirmed:true,CHK_011_Service_authorization_funding_confirmed_:true,CHK_012_Form_01_Client_Information_Face_Sheet_co:true,CHK_013_Form_01_Client_Information_Face_Sheet_co:true,CHK_014_Form_02_Rights_Notice_given_and_signed_r:true,CHK_015_Form_02_Rights_Notice_given_and_signed_r:true,CHK_016_Form_03_Policy_Acknowledgment_all_polici:true,CHK_017_Form_03_Policy_Acknowledgment_all_polici:true,CHK_018_Form_04_Release_s_of_Information_signed_:true,CHK_019_Form_04_Release_s_of_Information_signed_:true,CHK_020_Form_05_Medication_Authorization_signed_:true,CHK_021_Form_05_Medication_Authorization_signed_:true,CHK_022_Form_06_Funds_and_Property_Authorization:true,CHK_023_Form_06_Funds_and_Property_Authorization:true,CHK_024_Person_specific_orientation_completed_by:true,CHK_025_Person_specific_orientation_completed_by:true,CHK_026_Form_07_Preliminary_Support_Plan_Self_Ma:true,CHK_027_Form_07_Preliminary_Support_Plan_Self_Ma:true,CHK_028_Support_team_meeting_held_within_45_cale:true,CHK_029_Support_team_meeting_held_within_45_cale:true,CHK_030_CSSP_Addendum_written_and_signed_Form_08:true,CHK_031_CSSP_Addendum_written_and_signed_Form_08:true,CHK_032_Progress_review_schedule_set_per_the_per:true,CHK_033_Progress_review_schedule_set_per_the_per:true,CHK_034_Medication_Administration_Record_MAR_sta:true,CHK_035_Medication_Administration_Record_MAR_sta:true,CHK_036_All_signed_forms_uploaded_to_the_person_:true,CHK_037_All_signed_forms_uploaded_to_the_person_:true,
}};
