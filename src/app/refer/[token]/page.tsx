import ReferralForm from "./referral-form";
export const metadata={robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function ReferralPage({params}:{params:Promise<{token:string}>}){return <ReferralForm token={(await params).token}/>}
