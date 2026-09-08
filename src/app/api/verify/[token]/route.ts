import { verifyCertificate } from "@/domain/evidence/service";
export async function GET(_:Request,c:{params:Promise<{token:string}>}){const value=await verifyCertificate((await c.params).token);return value?Response.json(value):Response.json({valid:false},{status:404})}
