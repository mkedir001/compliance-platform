import ClaimAuthenticated from "./claim-authenticated";

export default async function ClaimAuthenticatedPage({ params }: { params: Promise<{ token: string }> }) {
  return <ClaimAuthenticated token={(await params).token} />;
}
