"use client";
import { useState } from "react";
import { SignatureRecipientFields } from "@/app/admin/clients/signature-recipient-fields";

export default function RecipientFocusFixture(){
  const[name,setName]=useState(""),[email,setEmail]=useState("");
  return <main><h1>Signature recipient focus fixture</h1><form><SignatureRecipientFields name={name} email={email} onNameChange={setName} onEmailChange={setEmail} autoFocus/><output data-testid="recipient-value">{name}</output></form></main>;
}
