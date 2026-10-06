import { notFound } from "next/navigation";
import EmployerOperationsPortal from "@/app/admin/operations-portal";

export default function DevelopmentOperationsHarness(){
  if(process.env.NODE_ENV==="production") notFound();
  return <><nav className="phase-nav" aria-label="Employer administration"><a href="/dev/harness">Foundation console</a><a href="/admin/setup">Organization setup</a><a href="/admin/workforce-onboarding">Workforce onboarding</a><a href="/admin/action-center">Action center</a><a href="/admin/policy-operations">Policy operations</a><a href="/admin/evidence-operations">Evidence operations</a><a href="/admin/reporting">Reporting and audit</a><a href="/notifications">Notifications</a></nav><EmployerOperationsPortal/></>;
}
