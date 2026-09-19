import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { productionEnvironment } from "@/lib/env";
import { AuthenticationError } from "./errors";

export function productionAuthSignature(userId: string, timestamp: string, secret: string) { return createHmac("sha256", secret).update(`${timestamp}.${userId}`).digest("hex"); }
function productionUserId(request: Request) {
  const config = productionEnvironment()!, userId = request.headers.get("x-auth-user-id"), timestamp = request.headers.get("x-auth-timestamp"), signature = request.headers.get("x-auth-signature");
  if (!userId || !timestamp || !signature || !/^\d+$/.test(timestamp)) throw new AuthenticationError("Authentication required");
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) throw new AuthenticationError("Authentication assertion expired");
  const expected = productionAuthSignature(userId, timestamp, config.AUTH_PROXY_SECRET), received = Buffer.from(signature, "hex"), expectedBytes = Buffer.from(expected, "hex");
  if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) throw new AuthenticationError("Authentication assertion invalid");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) { const origin = request.headers.get("origin"); if (origin && new URL(origin).origin !== new URL(config.APP_BASE_URL).origin) throw new AuthenticationError("Request origin rejected"); }
  return userId;
}

/** Production identity is asserted by a trusted proxy using a short-lived HMAC.
 * The development user header is never accepted in production. */
export async function requireAuthenticatedUser(request: Request) {
  const userId = process.env.NODE_ENV === "production" ? productionUserId(request) : request.headers.get("x-dev-user-id") ?? process.env.DEV_USER_ID;
  if (!userId) throw new AuthenticationError("Authentication required");
  const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" } });
  if (!user) throw new AuthenticationError("Active user not found");
  return user;
}
