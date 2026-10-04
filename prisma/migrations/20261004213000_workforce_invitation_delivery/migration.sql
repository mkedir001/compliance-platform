-- Add explicit provider-acceptance observability without changing invitation validity.
CREATE TYPE "EmployeePortalInvitationDeliveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED');

ALTER TABLE "EmployeePortalInvitation"
  ADD COLUMN "deliveryStatus" "EmployeePortalInvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryProvider" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryErrorCode" TEXT;
