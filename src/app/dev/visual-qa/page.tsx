import { notFound } from "next/navigation";
import { DEVELOPMENT_VISUAL_QA_ORGANIZATION_NAME, DEVELOPMENT_VISUAL_QA_OWNER_EMAIL, developmentVisualQaMode } from "@/domain/auth/development-visual-qa";

export default function VisualQaSessionPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  if (!developmentVisualQaMode()) notFound();
  void searchParams;
  return <main className="portal-shell"><header className="portal-header"><p className="eyebrow">Development only</p><h1>Local visual QA</h1><p className="lede">Enter the redesigned portal as the seeded organization owner. Identity and organization access are resolved from application membership.</p></header><section><h2>{DEVELOPMENT_VISUAL_QA_ORGANIZATION_NAME}</h2><p>Development owner: {DEVELOPMENT_VISUAL_QA_OWNER_EMAIL}</p><form action="/dev/visual-qa/session" method="post"><button type="submit">Enter visual QA as organization owner</button></form><p><small>This local session is unavailable in production and contains synthetic development data only.</small></p></section></main>;
}
