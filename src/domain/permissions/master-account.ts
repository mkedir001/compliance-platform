import { prisma } from "@/lib/prisma";

/**
 * The master (super user) account. Which accounts are masters is deployment configuration, not data a user can
 * edit: set MASTER_ACCOUNT_EMAILS to a comma-separated list of sign-in emails. A master receives every
 * permission in every organization it is an active member of. It does not bypass what a permission can never
 * stand in for, such as a person's own qualification to administer medication.
 */
export const masterAccountEmails = () => [...new Set((process.env.MASTER_ACCOUNT_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean))];

export async function isMasterAccount(userId: string) {
  const emails = masterAccountEmails();
  if (!emails.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
  return Boolean(user?.email && user.status === "ACTIVE" && emails.includes(user.email.trim().toLowerCase()));
}
