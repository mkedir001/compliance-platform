import { notFound } from "next/navigation";
import RecipientFocusFixture from "./recipient-focus-fixture";

export default function Page(){
  if(process.env.NODE_ENV==="production")notFound();
  return <RecipientFocusFixture/>;
}
