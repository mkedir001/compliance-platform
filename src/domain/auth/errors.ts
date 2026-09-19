export class AuthenticationError extends Error { status = 401; }
export class AuthorizationError extends Error { status = 403; }
export class ResourceNotFoundError extends Error { status = 404; }
export class ValidationError extends Error { status = 400; details?: unknown; constructor(message:string,details?:unknown){super(message);this.details=details;} }

export function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError || error instanceof ResourceNotFoundError || error instanceof ValidationError) {
    return Response.json({ error: error.message, ...(error instanceof ValidationError && error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "Invalid input", details: error }, { status: 400 });
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
