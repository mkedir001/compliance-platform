import { prisma } from "@/lib/prisma";
import { AuthenticationError } from "./errors";

/** Replace this adapter with the production identity provider. A client-supplied
 * user id is accepted only outside production to make the foundation testable. */
export async function requireAuthenticatedUser(request: Request) {
  const userId = process.env.NODE_ENV === "production" ? null : request.headers.get("x-dev-user-id") ?? process.env.DEV_USER_ID;
  if (!userId) throw new AuthenticationError("Authentication required");
  const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" } });
  if (!user) throw new AuthenticationError("Active user not found");
  return user;
}
