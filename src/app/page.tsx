import { FoundationConsole } from "./foundation-console";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/domain/auth/authentication";
import { resolveAuthenticatedLanding } from "@/domain/auth/landing";

export default async function Page() {
  if (process.env.NODE_ENV !== "production") return <FoundationConsole />;
  try {
    const incoming = await headers();
    const request = new Request(process.env.APP_BASE_URL ?? "http://localhost", { headers: Object.fromEntries(incoming.entries()) });
    const user = await requireAuthenticatedUser(request);
    const destinations = await resolveAuthenticatedLanding(user.id);
    if (destinations.length === 1) redirect(destinations[0].href);
    if (destinations.length > 1) return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Compliance Platform</p><h1>Choose an experience</h1><p className="lede">Select an authorized organization experience. Available navigation and server access follow effective permissions.</p></header><section>{destinations.map((destination,index) => <article key={`${destination.organizationId}-${destination.experience}-${index}`}><h2>{destination.organizationName}</h2><p>{destination.experience === "admin" ? "Management / back-office" : destination.experience==="auditor"?"Temporary read-only auditor review":"Employee self-service"}</p><a href={destination.href}>Continue</a></article>)}</section></main>;
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
  }
  return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Compliance Platform</p><h1>Access unavailable</h1><p className="lede">This authenticated identity is not linked to an active authorized application account.</p></header></main>;
}
