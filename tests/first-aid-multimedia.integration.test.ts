import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { seedProductionCurriculum } from "../prisma/seed-curriculum";
import { validateCourseVersion } from "@/domain/training/curriculum/service";

const db = new PrismaClient();

describe("245D-110 multimedia versioning", () => {
  it("publishes a new media-bearing version while preserving pinned version-one assignments", async () => {
    const course = await db.trainingCourse.findFirstOrThrow({ where: { organizationId: null, code: "245D-110" }, include: { versions: { orderBy: { versionNumber: "asc" }, include: { modules: { include: { contentItems: true } } } } } });
    const versionOne = course.versions.find(version => version.versionNumber === 1)!, versionTwo = course.versions.find(version => version.versionNumber === 2)!;
    expect(versionOne.status).toBe("SUPERSEDED"); expect(versionTwo.status).toBe("ACTIVE");
    const video = versionTwo.modules.flatMap(module => module.contentItems).find(item => item.contentType === "VIDEO");
    expect(video?.required).toBe(true);
    expect(video?.payload).toMatchObject({ provider: "American Heart Association", sourceUrl: "https://cpr.heart.org/en/cpr-courses-and-kits/hands-only-cpr", delivery: "EXTERNAL_LINK", completionMode: "LEARNER_ACKNOWLEDGMENT" });
    expect((await validateCourseVersion(versionTwo.id)).valid).toBe(true);
    const organization = await db.organization.findFirstOrThrow({ where: { slug: "northstar-support-services" } }), employee = await db.employee.findFirstOrThrow({ where: { organizationId: organization.id } });
    const pinned = await db.trainingAssignment.create({ data: { fingerprint: `first-aid-v1-pinned-${Date.now()}`, organizationId: organization.id, employeeId: employee.id, courseVersionId: versionOne.id, sourceType: "MANUAL" } });
    await seedProductionCurriculum(db);
    expect((await db.trainingAssignment.findUniqueOrThrow({ where: { id: pinned.id } })).courseVersionId).toBe(versionOne.id);
    const defaultOption = await db.requirementTrainingOption.findFirstOrThrow({ where: { isDefault: true, complianceRequirementVersion: { requirement: { code: "245D-WF-012" } } }, include: { trainingCourseVersion: true } });
    expect(defaultOption.trainingCourseVersion.versionNumber).toBe(2);
    expect(await db.certificate.count({ where: { organizationId: organization.id, employeeId: employee.id, courseVersionId: versionTwo.id } })).toBe(0);
  }, 120_000);
});
