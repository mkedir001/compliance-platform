import { createHash } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  ResourceNotFoundError,
} from "@/domain/auth/errors";
import {
  requireOrganizationAccess,
  requirePermission,
} from "@/domain/permissions/authorization";

const recordType = z.enum(["CLIENT", "EMPLOYEE"]);
const selectionSchema = z
  .array(
    z.object({
      type: recordType,
      id: z.string().cuid(),
      version: z.string().datetime(),
    }),
  )
  .min(1)
  .max(25);
type Selection = z.infer<typeof selectionSchema>[number];
type Classification = "DELETE_SAFE" | "ARCHIVE_REQUIRED" | "BLOCKED";

async function authorize(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "organization.manage");
  return membership;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, value) => total + value, 0);

async function analyzeClient(organizationId: string, id: string) {
  const row = await prisma.client.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      legalFirstName: true,
      legalLastName: true,
      status: true,
      updatedAt: true,
      testDataMarkedAt: true,
      _count: {
        select: {
          services: true,
          representatives: true,
          emergencyContacts: true,
          medications: true,
          contacts: true,
          intakes: true,
          documents: true,
          roiAuthorizations: true,
          signatureEnvelopes: true,
          documentRequests: true,
          auditAccessScopes: true,
          importSessions: true,
          referrals: true,
          referralIntakeDrafts: true,
          documentQuestionnaires: true,
        },
      },
    },
  });
  if (!row)
    throw new ResourceNotFoundError(
      "Selected client was not found in this organization",
    );
  const dependencies = {
    referrals: row._count.referrals + row._count.referralIntakeDrafts,
    intakes: row._count.intakes,
    documents: row._count.documents,
    signatures: row._count.signatureEnvelopes,
    trainingRecords: 0,
    assignments: row._count.services,
    complianceEvidence:
      row._count.roiAuthorizations +
      row._count.auditAccessScopes +
      row._count.documentQuestionnaires,
    requests: row._count.documentRequests,
    imports: row._count.importSessions,
    contacts:
      row._count.contacts +
      row._count.representatives +
      row._count.emergencyContacts,
    medications: row._count.medications,
  };
  const auditDependencies = await prisma.auditEvent.count({
      where: { organizationId, entityType: "Client", entityId: id },
    }),
    protectedCount =
      dependencies.referrals +
      dependencies.documents +
      dependencies.signatures +
      dependencies.complianceEvidence +
      dependencies.requests +
      dependencies.imports,
    nonIntakeCount = sum(dependencies) - dependencies.intakes;
  let classification: Classification = "ARCHIVE_REQUIRED",
    reason = "Archival preserves the selected legacy record and its history.";
  if (["ACTIVE", "DISCHARGED"].includes(row.status)) {
    classification = "BLOCKED";
    reason =
      "Active or discharged client records cannot be removed by test-data cleanup.";
  } else if (
    row.testDataMarkedAt &&
    protectedCount === 0 &&
    nonIntakeCount === 0
  ) {
    classification = "DELETE_SAFE";
    reason =
      "Explicitly marked synthetic prospective record has no protected dependencies.";
  } else if (protectedCount) {
    classification = "ARCHIVE_REQUIRED";
    reason =
      "Linked documents, referrals, signatures, or compliance evidence must be retained.";
  }
  return {
    type: "CLIENT" as const,
    id: row.id,
    identity: `${row.legalFirstName} ${row.legalLastName}`,
    status: row.status,
    version: row.updatedAt.toISOString(),
    explicitlyMarked: Boolean(row.testDataMarkedAt),
    dependencies: { ...dependencies, auditHistory: auditDependencies },
    classification,
    reason,
  };
}

async function analyzeEmployee(organizationId: string, id: string) {
  const row = await prisma.employee.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employmentStatus: true,
      userId: true,
      updatedAt: true,
      testDataMarkedAt: true,
      _count: {
        select: {
          roles: true,
          duties: true,
          serviceEvents: true,
          complianceInstances: true,
          trainingAssignments: true,
          trainingCompletions: true,
          assessmentAttempts: true,
          trainingAcknowledgments: true,
          competencyAssessments: true,
          assessedCompetencies: true,
          professionalCredentials: true,
          externalTrainingRecords: true,
          attestations: true,
          certificates: true,
          onboardings: true,
          policyAssignments: true,
          workReadinessEvaluations: true,
          medicationQualifications: true,
          medicationInstructions: true,
          medicationAuthorizations: true,
          serviceAssignments: true,
          assignmentEvaluations: true,
          complianceIssues: true,
          portalInvitations: true,
          auditAccessScopes: true,
        },
      },
    },
  });
  if (!row)
    throw new ResourceNotFoundError(
      "Selected employee was not found in this organization",
    );
  const c = row._count,
    dependencies = {
      referrals: 0,
      intakes: c.onboardings,
      documents: 0,
      signatures: c.attestations + c.trainingAcknowledgments,
      trainingRecords:
        c.trainingAssignments +
        c.trainingCompletions +
        c.assessmentAttempts +
        c.certificates +
        c.externalTrainingRecords,
      assignments: c.serviceAssignments + c.roles + c.duties,
      complianceEvidence:
        c.complianceInstances +
        c.competencyAssessments +
        c.assessedCompetencies +
        c.professionalCredentials +
        c.policyAssignments +
        c.workReadinessEvaluations +
        c.medicationQualifications +
        c.medicationInstructions +
        c.medicationAuthorizations +
        c.assignmentEvaluations +
        c.complianceIssues +
        c.auditAccessScopes,
      serviceEvents: c.serviceEvents,
      invitations: c.portalInvitations,
      authenticationLinks: row.userId ? 1 : 0,
    };
  const auditDependencies = await prisma.auditEvent.count({
      where: {
        organizationId,
        OR: [{ employeeId: id }, { entityType: "Employee", entityId: id }],
      },
    }),
    protectedCount =
      dependencies.signatures +
      dependencies.trainingRecords +
      dependencies.complianceEvidence +
      dependencies.serviceEvents;
  let classification: Classification = "ARCHIVE_REQUIRED",
    reason =
      "Archival deactivates the selected staff record while preserving its history.";
  if (row.userId) {
    classification = "BLOCKED";
    reason =
      "An authentication-linked employee cannot be removed by test-data cleanup.";
  } else if (row.testDataMarkedAt && sum(dependencies) === 0) {
    classification = "DELETE_SAFE";
    reason = "Explicitly marked synthetic employee has no dependent records.";
  } else if (protectedCount) {
    classification = "ARCHIVE_REQUIRED";
    reason =
      "Compliance, training, signature, or service evidence must be retained.";
  }
  return {
    type: "EMPLOYEE" as const,
    id: row.id,
    identity: `${row.firstName} ${row.lastName}`,
    status: row.employmentStatus,
    version: row.updatedAt.toISOString(),
    explicitlyMarked: Boolean(row.testDataMarkedAt),
    dependencies: { ...dependencies, auditHistory: auditDependencies },
    classification,
    reason,
  };
}

async function analyze(organizationId: string, selections: Selection[]) {
  return Promise.all(
    selections.map((item) =>
      item.type === "CLIENT"
        ? analyzeClient(organizationId, item.id)
        : analyzeEmployee(organizationId, item.id),
    ),
  );
}

export async function searchCleanupCandidates(
  user: Pick<User, "id">,
  organizationId: string,
  raw: { type?: string; search?: string },
) {
  await authorize(user, organizationId);
  const input = z
      .object({
        type: recordType.default("CLIENT"),
        search: z.string().trim().max(100).default(""),
      })
      .parse(raw),
    search = input.search;
  if (input.type === "CLIENT")
    return prisma.client.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { legalFirstName: { contains: search, mode: "insensitive" } },
                { legalLastName: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        legalFirstName: true,
        legalLastName: true,
        status: true,
        updatedAt: true,
        testDataMarkedAt: true,
        testDataReason: true,
      },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
      take: 50,
    });
  return prisma.employee.findMany({
    where: {
      organizationId,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeNumber: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeNumber: true,
      employmentStatus: true,
      updatedAt: true,
      testDataMarkedAt: true,
      testDataReason: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 50,
  });
}

export async function markTestData(
  user: Pick<User, "id">,
  organizationId: string,
  raw: unknown,
) {
  await authorize(user, organizationId);
  const input = z
      .object({
        type: recordType,
        id: z.string().cuid(),
        version: z.string().datetime(),
        reason: z.string().trim().min(8).max(500),
        confirmation: z.literal("MARK AS TEST DATA"),
      })
      .parse(raw),
    at = new Date(),
    where = {
      id: input.id,
      organizationId,
      updatedAt: new Date(input.version),
    };
  const result =
    input.type === "CLIENT"
      ? await prisma.client.updateMany({
          where,
          data: {
            testDataMarkedAt: at,
            testDataMarkedByUserId: user.id,
            testDataReason: input.reason,
          },
        })
      : await prisma.employee.updateMany({
          where,
          data: {
            testDataMarkedAt: at,
            testDataMarkedByUserId: user.id,
            testDataReason: input.reason,
          },
        });
  if (!result.count)
    throw new ConflictError(
      "The selected record changed or is outside this organization. Refresh before marking it.",
      "STALE_RECORD",
    );
  await prisma.auditEvent.create({
    data: {
      organizationId,
      actorUserId: user.id,
      eventType: "test_data.marked",
      entityType: input.type === "CLIENT" ? "Client" : "Employee",
      entityId: input.id,
      metadataJson: { reason: input.reason },
    },
  });
  return { marked: true, markedAt: at };
}

export async function createCleanupPreview(
  user: Pick<User, "id">,
  organizationId: string,
  raw: unknown,
  at = new Date(),
) {
  await authorize(user, organizationId);
  const selections = selectionSchema.parse(raw),
    rows = await analyze(organizationId, selections);
  for (const selection of selections) {
    const row = rows.find(
      (item) => item.type === selection.type && item.id === selection.id,
    );
    if (!row || row.version !== selection.version)
      throw new ConflictError(
        "A selected record changed. Refresh the selection before previewing cleanup.",
        "STALE_RECORD",
      );
  }
  const selectionHash = digest(rows),
    expiresAt = new Date(at.getTime() + 15 * 60_000),
    preview = await prisma.testDataCleanupPreview.create({
      data: {
        organizationId,
        requestedByUserId: user.id,
        selectionHash,
        selectionJson: selections as Prisma.InputJsonValue,
        snapshotJson: rows as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  await prisma.auditEvent.create({
    data: {
      organizationId,
      actorUserId: user.id,
      eventType: "test_data.cleanup_previewed",
      entityType: "TestDataCleanupPreview",
      entityId: preview.id,
      metadataJson: { selectionHash, recordCount: rows.length },
    },
  });
  return {
    previewId: preview.id,
    expiresAt,
    status: preview.status,
    records: rows,
  };
}

export async function executeCleanupPreview(
  user: Pick<User, "id">,
  organizationId: string,
  previewId: string,
  raw: unknown,
  at = new Date(),
) {
  await authorize(user, organizationId);
  const input = z
      .object({
        confirmation: z.literal("CLEAN SELECTED TEST DATA"),
        idempotencyKey: z.string().uuid(),
      })
      .parse(raw),
    priorByKey = await prisma.testDataCleanupPreview.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
  if (priorByKey) {
    if (
      priorByKey.organizationId !== organizationId ||
      priorByKey.id !== previewId
    )
      throw new ConflictError(
        "This cleanup request key was already used.",
        "IDEMPOTENCY_CONFLICT",
      );
    return priorByKey.resultJson;
  }
  const preview = await prisma.testDataCleanupPreview.findFirst({
    where: { id: previewId, organizationId },
  });
  if (!preview) throw new ResourceNotFoundError("Cleanup preview not found");
  if (preview.status === "EXECUTED") return preview.resultJson;
  if (preview.status !== "READY")
    throw new ConflictError(
      "This cleanup preview is no longer executable.",
      "PREVIEW_NOT_READY",
    );
  if (preview.expiresAt <= at) {
    await prisma.testDataCleanupPreview.update({
      where: { id: preview.id },
      data: { status: "EXPIRED" },
    });
    throw new ConflictError(
      "Cleanup preview expired. Create a new preview.",
      "PREVIEW_EXPIRED",
    );
  }
  const selections = selectionSchema.parse(preview.selectionJson),
    current = await analyze(organizationId, selections);
  if (digest(current) !== preview.selectionHash) {
    await prisma.testDataCleanupPreview.update({
      where: { id: preview.id },
      data: { status: "STALE" },
    });
    throw new ConflictError(
      "A selected record or dependency changed. Review a new cleanup preview.",
      "STALE_PREVIEW",
    );
  }
  const result = await prisma.$transaction(
    async (tx) => {
      const outcomes: {
        type: string;
        id: string;
        action: string;
        status: string;
      }[] = [];
      for (const row of current) {
        if (row.classification === "BLOCKED") {
          outcomes.push({
            type: row.type,
            id: row.id,
            action: "NONE",
            status: "BLOCKED",
          });
          continue;
        }
        if (row.type === "CLIENT" && row.classification === "DELETE_SAFE") {
          const intakes = await tx.clientIntake.findMany({
            where: { organizationId, clientId: row.id },
            select: { id: true },
          });
          await tx.clientIntakeChecklistItem.deleteMany({
            where: { intakeId: { in: intakes.map((item) => item.id) } },
          });
          await tx.clientIntake.deleteMany({
            where: { organizationId, clientId: row.id },
          });
          const deleted = await tx.client.deleteMany({
            where: {
              id: row.id,
              organizationId,
              updatedAt: new Date(row.version),
              testDataMarkedAt: { not: null },
            },
          });
          if (!deleted.count)
            throw new ConflictError(
              "A selected client changed during cleanup.",
              "STALE_PREVIEW",
            );
          outcomes.push({
            type: row.type,
            id: row.id,
            action: "DELETE",
            status: "COMPLETED",
          });
        } else if (
          row.type === "EMPLOYEE" &&
          row.classification === "DELETE_SAFE"
        ) {
          const deleted = await tx.employee.deleteMany({
            where: {
              id: row.id,
              organizationId,
              updatedAt: new Date(row.version),
              testDataMarkedAt: { not: null },
              userId: null,
            },
          });
          if (!deleted.count)
            throw new ConflictError(
              "A selected employee changed during cleanup.",
              "STALE_PREVIEW",
            );
          outcomes.push({
            type: row.type,
            id: row.id,
            action: "DELETE",
            status: "COMPLETED",
          });
        } else if (row.type === "CLIENT") {
          const archived = await tx.client.updateMany({
            where: {
              id: row.id,
              organizationId,
              updatedAt: new Date(row.version),
            },
            data: { status: "ARCHIVED", archivedAt: at },
          });
          if (!archived.count)
            throw new ConflictError(
              "A selected client changed during cleanup.",
              "STALE_PREVIEW",
            );
          outcomes.push({
            type: row.type,
            id: row.id,
            action: "ARCHIVE",
            status: "COMPLETED",
          });
        } else {
          const archived = await tx.employee.updateMany({
            where: {
              id: row.id,
              organizationId,
              updatedAt: new Date(row.version),
              userId: null,
            },
            data: { employmentStatus: "ARCHIVED" },
          });
          if (!archived.count)
            throw new ConflictError(
              "The employee changed or has an authentication link and cannot be archived.",
              "STALE_PREVIEW",
            );
          outcomes.push({
            type: row.type,
            id: row.id,
            action: "ARCHIVE",
            status: "COMPLETED",
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId,
            actorUserId: user.id,
            eventType: "test_data.cleanup_executed",
            entityType: row.type === "CLIENT" ? "Client" : "Employee",
            entityId: row.id,
            metadataJson: {
              action: outcomes.at(-1)!.action,
              previewId: preview.id,
            },
          },
        });
      }
      const resultJson = {
        previewId: preview.id,
        completedAt: at.toISOString(),
        outcomes,
      };
      const claimed = await tx.testDataCleanupPreview.updateMany({
        where: {
          id: preview.id,
          organizationId,
          status: "READY",
          idempotencyKey: null,
        },
        data: {
          status: "EXECUTED",
          executedAt: at,
          idempotencyKey: input.idempotencyKey,
          resultJson: resultJson as Prisma.InputJsonValue,
        },
      });
      if (!claimed.count)
        throw new ConflictError(
          "Cleanup preview was already executed or changed.",
          "PREVIEW_NOT_READY",
        );
      return resultJson;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return result;
}

export async function getCleanupAuditHistory(
  user: Pick<User, "id">,
  organizationId: string,
) {
  await authorize(user, organizationId);
  return prisma.auditEvent.findMany({
    where: {
      organizationId,
      eventType: {
        in: [
          "test_data.marked",
          "test_data.cleanup_previewed",
          "test_data.cleanup_executed",
        ],
      },
    },
    select: {
      id: true,
      eventType: true,
      entityType: true,
      entityId: true,
      metadataJson: true,
      occurredAt: true,
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
}
