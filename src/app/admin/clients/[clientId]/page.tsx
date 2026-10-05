import ClientsPortal from "../clients-portal";

export default async function ClientRecordPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ organizationId?: string; documentId?: string; requestId?: string; view?: string }> }) {
  const [{ clientId }, { organizationId = "", documentId = "", requestId = "", view = "" }] = await Promise.all([params, searchParams]);
  return <ClientsPortal initialOrganizationId={organizationId} initialClientId={clientId} initialDocumentId={documentId} initialRequestId={requestId} initialView={view} productionIdentity={process.env.NODE_ENV === "production"} />;
}
