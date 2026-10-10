import type { ClientDocumentType, ClientImportClassification } from "@prisma/client";

export type ClientDocumentCategory="INTAKE"|"RIGHTS_AND_CONSENT"|"SUPPORT_PLANNING"|"ASSESSMENTS"|"SERVICE_AUTHORIZATION"|"GENERAL";
export type ClientDocumentDefinition={
  id:ClientImportClassification;
  label:string;
  category:ClientDocumentCategory;
  aliases:readonly string[];
  extractionMapping?:"INTAKE_CHECKLIST"|"FACE_SHEET"|"RIGHTS_ACKNOWLEDGMENT"|"ROI";
  signaturePolicy?:"PLATFORM_SUPPORTED"|"EXTERNAL_REVIEW_ONLY";
  renewalPolicy?:"ANNUAL"|"EXPIRATION_DATE_DRIVEN";
  generationCapability?:"PLATFORM_TEMPLATE";
};

export const clientDocumentRegistry:readonly ClientDocumentDefinition[]=[
  {id:"ADMISSION_FORM",label:"Admission Form",category:"INTAKE",aliases:["admission form","admission application"]},
  {id:"FACE_SHEET",label:"Face Sheet",category:"INTAKE",aliases:["client information / face sheet","face sheet"],extractionMapping:"FACE_SHEET",signaturePolicy:"PLATFORM_SUPPORTED",generationCapability:"PLATFORM_TEMPLATE"},
  {id:"INTAKE_CHECKLIST",label:"Intake Checklist",category:"INTAKE",aliases:["intake checklist","first day of service"],extractionMapping:"INTAKE_CHECKLIST",signaturePolicy:"PLATFORM_SUPPORTED",generationCapability:"PLATFORM_TEMPLATE"},
  {id:"RIGHTS_ACKNOWLEDGMENT",label:"Rights Acknowledgment",category:"RIGHTS_AND_CONSENT",aliases:["rights acknowledgment","service recipient rights acknowledgment"],extractionMapping:"RIGHTS_ACKNOWLEDGMENT",signaturePolicy:"PLATFORM_SUPPORTED",renewalPolicy:"ANNUAL",generationCapability:"PLATFORM_TEMPLATE"},
  {id:"RIGHTS_OF_PERSONS_SERVED",label:"Rights of Persons Served",category:"RIGHTS_AND_CONSENT",aliases:["rights of persons served","service recipient rights","protection-related rights"],signaturePolicy:"EXTERNAL_REVIEW_ONLY"},
  {id:"ROI",label:"Release of Information",category:"RIGHTS_AND_CONSENT",aliases:["release of information","authorization to release information"],extractionMapping:"ROI",signaturePolicy:"PLATFORM_SUPPORTED",renewalPolicy:"EXPIRATION_DATE_DRIVEN",generationCapability:"PLATFORM_TEMPLATE"},
  {id:"CSSP_SIGNATURE_PAGE",label:"CSSP Signature Page",category:"SUPPORT_PLANNING",aliases:["cssp signature page","coordinated services and supports plan signature page"],signaturePolicy:"EXTERNAL_REVIEW_ONLY"},
  {id:"CSSP_ADDENDUM",label:"CSSP Addendum",category:"SUPPORT_PLANNING",aliases:["cssp addendum","coordinated services and supports plan addendum"]},
  {id:"CSSP",label:"Coordinated Services and Supports Plan (CSSP)",category:"SUPPORT_PLANNING",aliases:["coordinated services and supports plan","cssp"]},
  {id:"COUNTY_SUPPORT_PLAN",label:"County Support Plan",category:"SUPPORT_PLANNING",aliases:["county support plan"]},
  {id:"IAPP",label:"Individual Abuse Prevention Plan (IAPP)",category:"SUPPORT_PLANNING",aliases:["individual abuse prevention plan","iapp"]},
  {id:"SMA_SIGNATURE_PAGE",label:"SMA Signature Page",category:"ASSESSMENTS",aliases:["sma signature page","self-management assessment signature page"],signaturePolicy:"EXTERNAL_REVIEW_ONLY"},
  {id:"SMA",label:"Self-Management Assessment (SMA)",category:"ASSESSMENTS",aliases:["self-management assessment","self management assessment","sma"]},
  {id:"SERVICE_AGREEMENT_LETTER",label:"Service Agreement Letter",category:"SERVICE_AUTHORIZATION",aliases:["service agreement letter"]},
  {id:"SERVICE_AUTHORIZATION",label:"Service Authorization",category:"SERVICE_AUTHORIZATION",aliases:["service authorization","service authorization letter"]},
  {id:"OTHER",label:"Other",category:"GENERAL",aliases:[]},
  {id:"UNKNOWN",label:"Unknown / Unclassified",category:"GENERAL",aliases:[]},
] as const;

export const clientDocumentDefinition=(id:ClientImportClassification)=>clientDocumentRegistry.find(item=>item.id===id)!;
export const clientDocumentTypeForImport=(id:ClientImportClassification)=>id as ClientDocumentType;
export function classifyDocumentText(text:string){
  const normalized=text.toLowerCase().replace(/\s+/g," ");
  // A document's own title appears first, so prefer the alias that occurs earliest near the top.
  const head=normalized.replace(/[^a-z0-9 ]+/g," ").replace(/ +/g," ").slice(0,600);
  let earliest:{id:typeof clientDocumentRegistry[number]["id"];alias:string;at:number}|null=null;
  for(const definition of clientDocumentRegistry){
    if(definition.id==="UNKNOWN"||definition.id==="OTHER")continue;
    for(const value of definition.aliases){const at=head.indexOf(value);if(at>=0&&(!earliest||at<earliest.at||(at===earliest.at&&value.length>earliest.alias.length)))earliest={id:definition.id,alias:value,at};}
  }
  if(earliest)return{classification:earliest.id,signal:`recognized phrase: ${earliest.alias}`};
  for(const definition of clientDocumentRegistry){
    if(definition.id==="UNKNOWN"||definition.id==="OTHER")continue;
    const alias=definition.aliases.find(value=>normalized.includes(value));
    if(alias)return{classification:definition.id,signal:`recognized phrase: ${alias}`};
  }
  return{classification:"UNKNOWN" as const,signal:null};
}
