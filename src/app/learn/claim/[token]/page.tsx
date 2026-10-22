import ClaimInvitation from "./claim-invitation";
import { inspectPublicInvitation, publicInvitationToken } from "@/domain/portal/public-invitation";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  if (!publicInvitationToken.safeParse(token).success) return <ClaimInvitation token={token} initialState="INVALID" />;
  try {
    await enforceRateLimit("public-portal-invitation-page", token, 20, 3600);
    return <ClaimInvitation token={token} initialState={(await inspectPublicInvitation(token)).state} />;
  } catch {
    return <ClaimInvitation token={token} initialState="UNAVAILABLE" />;
  }
}
