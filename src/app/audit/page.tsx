import AuditorPortal from "./portal";
export default async function AuditPage({searchParams}:{searchParams:Promise<{sessionId?:string}>}){const{sessionId=""}=await searchParams;return <AuditorPortal initialSessionId={sessionId} productionIdentity={process.env.NODE_ENV==="production"}/>}
