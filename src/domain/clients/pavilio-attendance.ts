import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { ValidationError } from "@/domain/auth/errors";
import { localTimeCandidates, stableHistoricalHash, type SupplementalAttendance } from "./historical-mar-matching";

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const REQUIRED_COLUMNS = ["Date of service", "Employee", "Employee #", "Service line", "Clock in", "Clock out", "Hours", "Source", "Visit status", "Manual EVV entry"] as const;
const ACCEPTED_STATUSES = new Set(["processed", "cliapproved"]);

export type PavilioRowError = { rowNumber: number; code: string; message: string };
export type ParsedPavilioAttendance = SupplementalAttendance & {
  sourceEmployeeId: string;
  sourceEmployeeName: string;
  serviceDate: string;
  serviceLine: string;
  visitStatus: string;
  evvSource: string;
  manualEvv: boolean;
  localClockIn: string;
  localClockOut: string;
};
export type PavilioWorkbookInspection = {
  workbookHash: string;
  sheetNames: string[];
  columns: string[];
  totalRows: number;
  usableRows: ParsedPavilioAttendance[];
  errors: PavilioRowError[];
  dateCoverage: { start: string; end: string } | null;
  sourceEmployees: { sourceEmployeeId: string; sourceEmployeeName: string; usableRowCount: number }[];
};

function workbookBuffer(base64: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new ValidationError("The attendance workbook is not valid base64");
  const value = Buffer.from(base64, "base64");
  if (!value.length || value.length > MAX_WORKBOOK_BYTES) throw new ValidationError("The attendance workbook must be a non-empty XLSX file no larger than 5 MB");
  if (value[0] !== 0x50 || value[1] !== 0x4b) throw new ValidationError("The attendance workbook must be an XLSX file");
  return value;
}

const pad = (value: number) => String(value).padStart(2, "0");
function excelLocal(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const day = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  return { day, time, seconds: value.getUTCSeconds(), label: `${day}T${time}:${pad(value.getUTCSeconds())}` };
}

type NormalizedInterval = { start: Date; end: Date; duration: number; localStart: string; localEnd: string } | { error: string };
function normalizeInterval(clockIn: unknown, clockOut: unknown, reportedHours: number | null, timeZone: string): NormalizedInterval {
  const start = excelLocal(clockIn), end = excelLocal(clockOut);
  if (!start) return { error: "MISSING_OR_INVALID_CLOCK_IN" as const };
  if (!end) return { error: "MISSING_OR_INVALID_CLOCK_OUT" as const };
  const starts = localTimeCandidates(start.day, start.time, timeZone).map(value => new Date(value.getTime() + start.seconds * 1_000));
  const ends = localTimeCandidates(end.day, end.time, timeZone).map(value => new Date(value.getTime() + end.seconds * 1_000));
  const candidates = starts.flatMap(a => ends.filter(b => b > a).map(b => ({ start: a, end: b, duration: (b.getTime() - a.getTime()) / 3_600_000 })));
  if (!candidates.length) return { error: "INVALID_CLOCK_INTERVAL" as const };
  const sorted = candidates.sort((a, b) => reportedHours === null ? a.duration - b.duration : Math.abs(a.duration - reportedHours) - Math.abs(b.duration - reportedHours));
  if (sorted.length > 1) {
    const first = reportedHours === null ? sorted[0].duration : Math.abs(sorted[0].duration - reportedHours);
    const second = reportedHours === null ? sorted[1].duration : Math.abs(sorted[1].duration - reportedHours);
    if (Math.abs(first - second) < 0.001) return { error: "AMBIGUOUS_LOCAL_TIME" as const };
  }
  return { start: sorted[0].start, end: sorted[0].end, duration: sorted[0].duration, localStart: start.label, localEnd: end.label };
}

const cellText = (row: ExcelJS.Row, column: number) => row.getCell(column).text.trim();
const cellNumber = (row: ExcelJS.Row, column: number) => {
  const value = row.getCell(column).value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(row.getCell(column).text);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function inspectPavilioWorkbookBase64(base64: string, timeZone: string): Promise<PavilioWorkbookInspection> {
  const buffer = workbookBuffer(base64), workbookHash = createHash("sha256").update(buffer).digest("hex"), workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as never); } catch { throw new ValidationError("The attendance workbook could not be read as XLSX"); }
  const sheet = workbook.getWorksheet("Shifts");
  if (!sheet) throw new ValidationError('The attendance workbook must contain a worksheet named "Shifts"');
  const columns = (sheet.getRow(1).values as unknown[]).slice(1).map(value => String(value ?? "").trim());
  const index = new Map(columns.map((name, offset) => [name, offset + 1]));
  const missing = REQUIRED_COLUMNS.filter(name => !index.has(name));
  if (missing.length) throw new ValidationError(`The Shifts worksheet is missing required columns: ${missing.join(", ")}`);

  const errors: PavilioRowError[] = [], usableRows: ParsedPavilioAttendance[] = [], seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const get = (name: typeof REQUIRED_COLUMNS[number]) => row.getCell(index.get(name)!).value;
    const sourceEmployeeId = cellText(row, index.get("Employee #")!), sourceEmployeeName = cellText(row, index.get("Employee")!);
    const serviceLine = cellText(row, index.get("Service line")!), visitStatus = cellText(row, index.get("Visit status")!), evvSource = cellText(row, index.get("Source")!), manualEvvText = cellText(row, index.get("Manual EVV entry")!);
    const serviceDate = excelLocal(get("Date of service")), reportedHours = cellNumber(row, index.get("Hours")!);
    const rowErrors: string[] = [];
    if (!sourceEmployeeId) rowErrors.push("MISSING_EMPLOYEE_IDENTIFIER");
    if (!sourceEmployeeName) rowErrors.push("MISSING_EMPLOYEE_NAME");
    if (!serviceDate) rowErrors.push("INVALID_SERVICE_DATE");
    if (!ACCEPTED_STATUSES.has(visitStatus.toLowerCase())) rowErrors.push("UNUSABLE_VISIT_STATUS");
    const interval = normalizeInterval(get("Clock in"), get("Clock out"), reportedHours, timeZone);
    if ("error" in interval) rowErrors.push(interval.error);
    if (serviceDate && !("error" in interval) && serviceDate.day !== interval.localStart.slice(0, 10)) rowErrors.push("SERVICE_DATE_MISMATCH");
    if (!("error" in interval) && reportedHours !== null && Math.abs(interval.duration - reportedHours) > 0.25) rowErrors.push("DURATION_MISMATCH");
    if (rowErrors.length) {
      for (const code of rowErrors) errors.push({ rowNumber, code, message: code.replaceAll("_", " ").toLowerCase() });
      continue;
    }
    if ("error" in interval || !serviceDate) continue;
    const rowHash = stableHistoricalHash({ source: "PAVILIO", sourceEmployeeId, serviceLine, clockIn: interval.localStart, clockOut: interval.localEnd, visitStatus: visitStatus.toLowerCase() });
    if (seen.has(rowHash)) { errors.push({ rowNumber, code: "DUPLICATE_ROW", message: "duplicate attendance row" }); continue; }
    seen.add(rowHash);
    usableRows.push({ rowHash, rowNumber, sourceEmployeeId, sourceEmployeeName, serviceDate: serviceDate.day, serviceLine, visitStatus, evvSource, manualEvv: manualEvvText.toLowerCase() === "yes", localClockIn: interval.localStart, localClockOut: interval.localEnd, employeeId: "", clockInAt: interval.start, clockOutAt: interval.end });
  }
  const days = usableRows.map(row => row.serviceDate).sort();
  const employees = new Map<string, { sourceEmployeeId: string; sourceEmployeeName: string; usableRowCount: number }>();
  for (const row of usableRows) {
    const current = employees.get(row.sourceEmployeeId);
    if (current && current.sourceEmployeeName !== row.sourceEmployeeName) errors.push({ rowNumber: row.rowNumber, code: "EMPLOYEE_NAME_CONFLICT", message: "one employee identifier has multiple names" });
    else employees.set(row.sourceEmployeeId, { sourceEmployeeId: row.sourceEmployeeId, sourceEmployeeName: row.sourceEmployeeName, usableRowCount: (current?.usableRowCount ?? 0) + 1 });
  }
  return { workbookHash, sheetNames: workbook.worksheets.map(value => value.name), columns, totalRows: Math.max(0, sheet.actualRowCount - 1), usableRows, errors, dateCoverage: days.length ? { start: days[0], end: days[days.length - 1] } : null, sourceEmployees: [...employees.values()].sort((a, b) => a.sourceEmployeeId.localeCompare(b.sourceEmployeeId)) };
}
