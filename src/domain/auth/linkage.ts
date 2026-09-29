import { createHash } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const linkageInput = z.union([
  z.object({ userId: z.string().min(1), email: z.undefined().optional(), subject: z.string().trim().min(1).max(256) }).strict(),
  z.object({ userId: z.undefined().optional(), email: z.string().email(), subject: z.string().trim().min(1).max(256) }).strict(),
]);

export type CognitoLinkageInput = z.infer<typeof linkageInput>;

export async function linkCognitoIdentity(raw: CognitoLinkageInput) {
  const input = linkageInput.parse(raw), email = input.email?.trim().toLowerCase();
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: input.userId ? { id: input.userId } : { email: email! } });
    if (!user || user.status !== "ACTIVE") throw new Error("Linkage refused: active internal user not found");
    if (user.authProviderUserId === input.subject) return linkageResult(user, "already-linked");
    if (user.authProviderUserId) throw new Error("Linkage refused: internal user already has a different external identity");
    const subjectOwner = await tx.user.findUnique({ where: { authProviderUserId: input.subject } });
    if (subjectOwner) throw new Error("Linkage refused: external identity is already linked to another user");
    const memberships = await tx.organizationMembership.findMany({ where: { userId: user.id, status: "ACTIVE" }, select: { organizationId: true } });
    if (!memberships.length) throw new Error("Linkage refused: user has no active organization membership");
    const updated = await tx.user.updateMany({ where: { id: user.id, authProviderUserId: null }, data: { authProviderUserId: input.subject } });
    if (updated.count !== 1) throw new Error("Linkage refused: user identity changed concurrently");
    const subjectFingerprint = createHash("sha256").update(input.subject).digest("hex");
    await tx.auditEvent.createMany({ data: memberships.map(({ organizationId }) => ({ organizationId, eventType: "authentication.identity_linked", entityType: "User", entityId: user.id, metadataJson: { provider: "amazon-cognito", subjectFingerprint } as Prisma.InputJsonValue })) });
    return linkageResult({ ...user, authProviderUserId: input.subject }, "linked");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function linkageResult(user: Pick<User, "id" | "authProviderUserId">, status: "linked" | "already-linked") {
  return { status, userId: user.id };
}
