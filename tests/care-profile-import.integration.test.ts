import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PrismaClient, type Prisma } from "@prisma/client";
import { confirmClientImport, getClientImport, processClientImportDocument, reviewClientImportProposal, stageClientImport } from "@/domain/clients/imports";

const db=new PrismaClient();
const analysis=(extracted:Array<{fieldPath:string;value:Prisma.InputJsonValue}>)=>({classification:"SMA",ocrRequired:false,extractionStatus:"TEXT_EXTRACTED",method:"NATIVE_TEXT",pageCount:1,text:"synthetic",rawFields:{},textPages:[{pageNumber:1,text:"synthetic",method:"NATIVE_TEXT"}],pagesRequiringOcr:[],ocr:null,semanticMappings:[],diagnostics:{stage:"COMPLETE",mappedProposalCount:extracted.length},signals:["synthetic"],extracted:extracted.map((item,index)=>({...item,sourceLocation:`Page 1 row ${index+1}`,method:"NATIVE_TEXT",confidence:.7}))});
async function pdf(){const value=await PDFDocument.create();value.addPage();return Buffer.from(await value.save())}

describe.sequential("care-profile import review",()=>{
  let organizationId:string,otherOrganizationId:string,userId:string,clientId:string;
  beforeAll(async()=>{const tag=`care-import-${Date.now()}`,[organization,other,user]=await Promise.all([db.organization.create({data:{legalName:tag,displayName:tag,slug:tag}}),db.organization.create({data:{legalName:`${tag}-other`,displayName:`${tag}-other`,slug:`${tag}-other`}}),db.user.create({data:{email:`${tag}@example.test`,status:"ACTIVE"}})]);organizationId=organization.id;otherOrganizationId=other.id;userId=user.id;for(const code of ["client.read","client.update"])await db.permission.upsert({where:{code},update:{},create:{code}});const role=await db.roleDefinition.create({data:{organizationId,code:"CARE_REVIEWER",name:"Care reviewer",scope:"ORGANIZATION",permissions:{create:(await db.permission.findMany({where:{code:{in:["client.read","client.update"]}}})).map(permission=>({permissionId:permission.id}))}}});await db.organizationMembership.create({data:{organizationId,userId,status:"ACTIVE",roles:{create:{roleDefinitionId:role.id}}}});const client=await db.client.create({data:{organizationId,legalFirstName:"Synthetic",legalLastName:"Client",phone:"555-0100",createdByUserId:userId}});clientId=client.id;await db.clientHealthProfile.create({data:{organizationId,clientId,diagnoses:"Existing reviewed diagnosis"}})});

  it("requires review, shows canonical differences, validates dates, persists provenance, and keeps period end separate from expiration",async()=>{
    const bytes=await pdf(),session=await stageClientImport({id:userId},organizationId,{target:"UPDATE_EXISTING",existingClientId:clientId,files:[{fileName:"assessment.pdf",mimeType:"application/pdf",pdfBase64:bytes.toString("base64")},{fileName:"assessment-renewal.pdf",mimeType:"application/pdf",pdfBase64:Buffer.concat([bytes,Buffer.from("\n% synthetic variant")]).toString("base64")}]});
    let current=await processClientImportDocument({id:userId},organizationId,session.id,session.documents[0].id,{analyze:async()=>analysis([{fieldPath:"care.waterSafetySkills",value:{label:"Water safety skills",answer:"",detail:"Staff nearby",note:"review required"}},{fieldPath:"health.diagnoses",value:"New unverified diagnosis"},{fieldPath:"document.creationDate",value:"7/2/2021"},{fieldPath:"document.periodEnd",value:"7/1/2023"}]) as never});
    current=await processClientImportDocument({id:userId},organizationId,session.id,session.documents[1].id,{analyze:async()=>analysis([{fieldPath:"document.creationDate",value:"8/2/2022"},{fieldPath:"document.expirationDate",value:"8/1/2024"}]) as never});
    expect(current.currentValues).toMatchObject({"client.phone":"555-0100","health.diagnoses":"Existing reviewed diagnosis"});
    expect(current.proposals.filter(item=>item.fieldPath==="document.creationDate").every(item=>item.state==="PROPOSED")).toBe(true);
    const care=current.proposals.find(item=>item.fieldPath==="care.waterSafetySkills")!,creation=current.proposals.find(item=>item.fieldPath==="document.creationDate")!;
    await expect(reviewClientImportProposal({id:userId},organizationId,session.id,{proposalId:care.id,state:"ACCEPTED"})).rejects.toThrow(/Choose Yes/);
    await expect(reviewClientImportProposal({id:userId},organizationId,session.id,{proposalId:creation.id,state:"CORRECTED",correctedValue:"2/30/2021"})).rejects.toThrow(/valid reviewed document date/);
    for(const proposal of current.proposals){const corrected=proposal.id===care.id?{label:"Water safety skills",answer:"YES",detail:"Staff nearby",note:"reviewed"}:undefined;await reviewClientImportProposal({id:userId},organizationId,session.id,{proposalId:proposal.id,state:corrected?"CORRECTED":"ACCEPTED",correctedValue:corrected})}
    await expect(getClientImport({id:userId},otherOrganizationId,session.id)).rejects.toThrow();
    const result=await confirmClientImport({id:userId},organizationId,session.id,{confirmed:true,target:"UPDATE_EXISTING",clientId,documents:[{documentId:session.documents[0].id,disposition:"PRESERVE_ONLY"},{documentId:session.documents[1].id,disposition:"PRESERVE_ONLY",validityReviewStatus:"CONFIRMED",expirationDate:"2024-08-01"}]}),documents=await db.clientDocument.findMany({where:{id:{in:result.createdDocuments}}}),firstSnapshot=documents.find(item=>item.originalFileName==="assessment.pdf")!.snapshotJson as Record<string,unknown>,secondSnapshot=documents.find(item=>item.originalFileName==="assessment-renewal.pdf")!.snapshotJson as Record<string,unknown>;
    expect((firstSnapshot.importReview as Record<string,unknown>).explicitExpirationDate).toBeNull();
    expect((secondSnapshot.importReview as Record<string,unknown>).explicitExpirationDate).toBe("2024-08-01");
    expect(firstSnapshot.reviewedFacts).toEqual(expect.arrayContaining([expect.objectContaining({fieldPath:"care.waterSafetySkills",sourceLocation:expect.stringContaining("Page 1")}),expect.objectContaining({fieldPath:"document.periodEnd"})]));
    expect(await db.clientHealthProfile.findUniqueOrThrow({where:{clientId}})).toMatchObject({diagnoses:"New unverified diagnosis"});
    expect(await db.auditEvent.count({where:{organizationId,entityId:session.id,eventType:{in:["client.import_proposal_reviewed","client.import_confirmed"]}}})).toBeGreaterThanOrEqual(2);
  });
});
