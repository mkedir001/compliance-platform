import { notFound } from "next/navigation";
import { FoundationConsole } from "@/app/foundation-console";

export default function DevelopmentHarnessPage(){
  if(process.env.NODE_ENV==="production") notFound();
  return <><nav className="phase-nav" aria-label="Development harness"><a href="/dev/harness/compliance-operations">Employer operations harness</a></nav><FoundationConsole/></>;
}
