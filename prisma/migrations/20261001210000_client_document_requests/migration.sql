-- CreateEnum
CREATE TYPE "ClientDocumentRequestStatus" AS ENUM ('DRAFT', 'SENT', 'OUTSTANDING', 'FULFILLED', 'CANCELED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ClientDocumentRequestRecipientType" AS ENUM ('CLIENT', 'REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "ClientDocumentRequestDeliveryChannel" AS ENUM ('EMAIL', 'MANUAL', 'SIGN_NOW');

-- CreateTable
CREATE TABLE "ClientDocumentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT,
    "documentType" "ClientDocumentType" NOT NULL,
    "recipientType" "ClientDocumentRequestRecipientType" NOT NULL,
    "representativeId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "deliveryChannel" "ClientDocumentRequestDeliveryChannel" NOT NULL,
    "status" "ClientDocumentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "dueAt" DATE,
    "staffNote" TEXT,
    "obligationDocumentId" TEXT,
    "fulfilledDocumentId" TEXT,
    "supersedesRequestId" TEXT,
    "activeKey" TEXT,
    "requestedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "latestFollowUpAt" TIMESTAMP(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "fulfilledAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocumentRequest_supersedesRequestId_key" ON "ClientDocumentRequest"("supersedesRequestId");
CREATE UNIQUE INDEX "ClientDocumentRequest_activeKey_key" ON "ClientDocumentRequest"("activeKey");
CREATE INDEX "document_request_org_client_status_due_idx" ON "ClientDocumentRequest"("organizationId", "clientId", "status", "dueAt");
CREATE INDEX "document_request_org_obligation_status_idx" ON "ClientDocumentRequest"("organizationId", "obligationDocumentId", "status");
CREATE INDEX "document_request_org_fulfillment_idx" ON "ClientDocumentRequest"("organizationId", "fulfilledDocumentId");

-- AddForeignKey
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClientDocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_representativeId_fkey" FOREIGN KEY ("representativeId") REFERENCES "ClientRepresentative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_obligationDocumentId_fkey" FOREIGN KEY ("obligationDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_fulfilledDocumentId_fkey" FOREIGN KEY ("fulfilledDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentRequest" ADD CONSTRAINT "ClientDocumentRequest_supersedesRequestId_fkey" FOREIGN KEY ("supersedesRequestId") REFERENCES "ClientDocumentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
