// AxisCare's public specification documents x-webhook-id as a unique subscriber identifier,
// not a signature or secret. Intake remains fail-closed until AxisCare provides verifiable
// request authentication. The parsing/deduplication processor is retained for that future point.
export async function POST(request: Request) {
  void request;
  return Response.json({ error: "AxisCare webhook intake is not enabled" }, { status: 503 });
}
