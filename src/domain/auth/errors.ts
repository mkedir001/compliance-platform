export class AuthenticationError extends Error { status = 401; }
export class AuthorizationError extends Error { status = 403; }
export class ResourceNotFoundError extends Error { status = 404; }
export class ValidationError extends Error { status = 400; details?: unknown; constructor(message:string,details?:unknown){super(message);this.details=details;} }

export function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError || error instanceof ResourceNotFoundError || error instanceof ValidationError) {
    return Response.json({ error: error.message, ...(error instanceof ValidationError && error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") { const issues = (error as { issues?: { code: string; path: PropertyKey[]; message: string }[] }).issues ?? []; return Response.json({ error: "Invalid input", details: issues.map(issue => ({ code: issue.code, path: issue.path.map(String), message: issue.message })) }, { status: 400 }); }
  const requestId = randomUUID();
  void recordOperationalEvent({ level: "error", operation: "request.failed", requestId, errorName: error instanceof Error ? error.name : "UnknownError", message: "Unhandled request failure" });
  return Response.json({ error: "Internal server error", requestId }, { status: 500 });
}
import { randomUUID } from "node:crypto";
import { recordOperationalEvent } from "@/lib/observability";
