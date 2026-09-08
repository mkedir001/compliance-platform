export class AuthenticationError extends Error { status = 401; }
export class AuthorizationError extends Error { status = 403; }
export class ResourceNotFoundError extends Error { status = 404; }

export function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError || error instanceof ResourceNotFoundError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "ZodError") return Response.json({ error: "Invalid input", details: error }, { status: 400 });
  console.error(error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
