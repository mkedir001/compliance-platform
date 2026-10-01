import SigningExperience from "./signing-experience";
import { getPublicSigningSession } from "@/domain/clients/signatures";
export default async function SigningPage({ params }: { params: Promise<{ token: string }> }) { const token=(await params).token;try{return <SigningExperience token={token} initialSession={await getPublicSigningSession(token)}/>;}catch{return <SigningExperience token={token} initialError="This signing invitation is invalid, expired, or no longer available."/>;} }
