import { claimContinuationCookie, readClaimContinuation } from "@/domain/auth/claim-continuation";

function cookieValue(request: Request, name: string) {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
}

export async function GET(request: Request) {
  const token = readClaimContinuation(cookieValue(request, claimContinuationCookie)), destination = token ? `/claim-auth/${encodeURIComponent(token)}` : "/learn/claim/invalid";
  const response = new Response(null, { status: 302, headers: { location: new URL(destination, request.url).toString() } });
  response.headers.append("set-cookie", `${claimContinuationCookie}=; Max-Age=0; Path=/learn/claim/resume; HttpOnly; Secure; SameSite=Lax`);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
