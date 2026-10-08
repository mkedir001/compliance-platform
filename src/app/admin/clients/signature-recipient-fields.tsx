"use client";

export function SignatureRecipientFields({name,email,onNameChange,onEmailChange,autoFocus=false}:{name:string;email:string;onNameChange:(value:string)=>void;onEmailChange:(value:string)=>void;autoFocus?:boolean}){
  return <>
    <label>Recipient name<input data-testid="signature-recipient-name" autoFocus={autoFocus} value={name} onChange={event=>onNameChange(event.target.value)} required/></label>
    <label>Delivery email<input data-testid="signature-recipient-email" type="email" value={email} onChange={event=>onEmailChange(event.target.value)} required/></label>
  </>;
}
