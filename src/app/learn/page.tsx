import EmployeePortal from "./portal";

export default async function Learn({searchParams}:{searchParams:Promise<{organizationId?:string}>}) { const{organizationId=""}=await searchParams,productionIdentity=process.env.NODE_ENV==="production";return <>{!productionIdentity?<nav className="phase-nav" aria-label="Employee self-service"><a href="/notifications">Notifications</a></nav>:null}<EmployeePortal initialOrganizationId={organizationId} productionIdentity={productionIdentity}/></>; }
