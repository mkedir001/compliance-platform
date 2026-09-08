import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { prisma } from "@/lib/prisma";
export async function GET(request: Request) { try { await requireAuthenticatedUser(request); return Response.json(await prisma.dutyDefinition.findMany({ orderBy: { name: "asc" } })); } catch (error) { return errorResponse(error); } }
