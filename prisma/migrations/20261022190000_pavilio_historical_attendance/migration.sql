-- Additive provenance fields allow a staged MAR occurrence to identify whether
-- AxisCare or a verified Pavilio row supplied the attendance coverage.
ALTER TABLE "HistoricalMarEntry"
  ADD COLUMN "attendanceSource" TEXT NOT NULL DEFAULT 'AXISCARE',
  ADD COLUMN "attendanceEvidenceKey" TEXT;

CREATE INDEX "HistoricalMarEntry_org_attendance_evidence_idx"
  ON "HistoricalMarEntry"("organizationId", "attendanceSource", "attendanceEvidenceKey");
