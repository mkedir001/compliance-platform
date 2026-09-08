import { prisma } from "@/lib/prisma";
import { reevaluateIfConfigured, reconcileOrganizationCompliance } from "./service";
export async function createEmployeeServiceEvent(data:Parameters<typeof prisma.employeeServiceEvent.create>[0]["data"]){const event=await prisma.employeeServiceEvent.create({data});await reevaluateIfConfigured(event.organizationId,event.employeeId,"SERVICE_EVENT_CREATED");return event;}
export async function assignEmployeeRole(data:Parameters<typeof prisma.employeeRole.create>[0]["data"],organizationId:string){const role=await prisma.employeeRole.create({data});await reevaluateIfConfigured(organizationId,role.employeeId,"ROLE_CHANGED");return role;}
export async function createOrganizationLicense(data:Parameters<typeof prisma.organizationLicense.create>[0]["data"]){const license=await prisma.organizationLicense.create({data});await reconcileOrganizationCompliance(license.organizationId);return license;}
