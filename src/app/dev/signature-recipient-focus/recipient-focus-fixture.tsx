"use client";
import { useState } from "react";
import { SignatureRecipientFields, SignatureStaffIdentityField } from "@/app/admin/clients/signature-recipient-fields";

export default function RecipientFocusFixture(){
  const[name,setName]=useState(""),[email,setEmail]=useState(""),[staffName,setStaffName]=useState(""),[staffConfirmed,setStaffConfirmed]=useState(false),[confirmationCount,setConfirmationCount]=useState(0);
  return <main><h1>Signature recipient focus fixture</h1><form><SignatureRecipientFields name={name} email={email} onNameChange={setName} onEmailChange={setEmail} autoFocus/><output data-testid="recipient-value">{name}</output></form><section aria-label="Staff identity fixture"><SignatureStaffIdentityField name={staffName} confirmed={staffConfirmed} onNameChange={setStaffName} onConfirm={()=>{setStaffConfirmed(true);setConfirmationCount(value=>value+1)}} onEdit={()=>setStaffConfirmed(false)}/><output data-testid="staff-draft-value">{staffName}</output><output data-testid="staff-confirmation-count">{confirmationCount}</output></section></main>;
}
