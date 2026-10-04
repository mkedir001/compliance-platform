import ClaimInvitation from "./claim-invitation";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  return <ClaimInvitation token={(await params).token} />;
}
