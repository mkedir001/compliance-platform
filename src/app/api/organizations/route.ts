import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { errorResponse } from "@/domain/auth/errors";
import { prisma } from "@/lib/prisma";
export async function GET(request: Request) {
  try { const user = await requireAuthenticatedUser(request); return Response.json(await prisma.organization.findMany({ where: { memberships: { some: { userId: user.id, status: "ACTIVE" } }, status: { not: "ARCHIVED" } }, orderBy: { displayName: "asc" } })); }
  catch (error) { return errorResponse(error); }
}
