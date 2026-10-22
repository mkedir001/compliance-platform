import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { inspectPavilioWorkbookBase64 } from "@/domain/clients/pavilio-attendance";

const headers = ["Date of service", "Weekday", "Employee", "Employee #", "Service line", "Clock in", "Clock out", "Hours", "Source", "Visit status", "Manual EVV entry"];
const local = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(Date.UTC(year, month - 1, day, hour, minute));
async function fixture(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Shifts"); workbook.addWorksheet("Summary");
  sheet.addRow(headers); for (const row of rows) sheet.addRow(row);
  for (const column of [1, 6, 7]) sheet.getColumn(column).numFmt = "mm/dd/yyyy hh:mm";
  const bytes = await workbook.xlsx.writeBuffer(); return Buffer.from(bytes as ArrayBuffer).toString("base64");
}
const row = (over: Record<number, unknown> = {}) => {
  const values: unknown[] = [local(2026, 1, 15), "Thursday", "Synthetic Caregiver", "SYN-001", "SERVICE", local(2026, 1, 15, 7), local(2026, 1, 15, 15), 8, "EVV (app/phone)", "Processed", "No"];
  for (const [index, value] of Object.entries(over)) values[Number(index)] = value;
  return values;
};

describe("Pavilio XLSX attendance adapter", () => {
  it("parses the actual workbook shape, rejects unusable rows, and deduplicates stable rows", async () => {
    const base64 = await fixture([row(), row(), row({ 6: null }), row({ 9: "Draft" }), row({ 0: local(2026, 1, 16), 5: local(2026, 1, 16, 22), 6: local(2026, 1, 17, 6) })]);
    const result = await inspectPavilioWorkbookBase64(base64, "America/Chicago");
    expect(result.sheetNames).toEqual(["Shifts", "Summary"]); expect(result.totalRows).toBe(5); expect(result.usableRows).toHaveLength(2);
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining(["DUPLICATE_ROW", "MISSING_OR_INVALID_CLOCK_OUT", "UNUSABLE_VISIT_STATUS"]));
    expect(result.dateCoverage).toEqual({ start: "2026-01-15", end: "2026-01-16" });
  });
  it("normalizes spring-forward and fall-back shifts using reported duration", async () => {
    const base64 = await fixture([
      row({ 0: local(2026, 3, 8), 5: local(2026, 3, 8, 0), 6: local(2026, 3, 8, 20, 38), 7: 19.75 }),
      row({ 0: local(2026, 11, 1), 3: "SYN-002", 5: local(2026, 11, 1, 1, 30), 6: local(2026, 11, 1, 2, 30), 7: 2 }),
    ]);
    const result = await inspectPavilioWorkbookBase64(base64, "America/Chicago");
    expect(result.usableRows).toHaveLength(2); expect(result.errors).toEqual([]);
    expect((result.usableRows[0].clockOutAt.getTime() - result.usableRows[0].clockInAt.getTime()) / 3_600_000).toBeCloseTo(19.633, 2);
    expect((result.usableRows[1].clockOutAt.getTime() - result.usableRows[1].clockInAt.getTime()) / 3_600_000).toBe(2);
  });
});
