import ClientsPortal from "../clients-portal";
import { resolveAdminOrganizationId } from "../../organization-context";

export default async function ClientRecordPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ organizationId?: string; documentId?: string; requestId?: string; view?: string }> }) {
  const [{ clientId }, { organizationId: requested = "", documentId = "", requestId = "", view = "" }] = await Promise.all([params, searchParams]);
  const organizationId = await resolveAdminOrganizationId(requested);
  return <ClientsPortal initialOrganizationId={organizationId} initialClientId={clientId} initialDocumentId={documentId} initialRequestId={requestId} initialView={view} productionIdentity />;
}
