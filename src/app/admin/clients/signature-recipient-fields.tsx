"use client";

export function SignatureRecipientFields({name,email,onNameChange,onEmailChange,autoFocus=false}:{name:string;email:string;onNameChange:(value:string)=>void;onEmailChange:(value:string)=>void;autoFocus?:boolean}){
  return <>
    <label>Recipient name<input data-testid="signature-recipient-name" autoFocus={autoFocus} value={name} onChange={event=>onNameChange(event.target.value)} required/></label>
    <label>Delivery email<input data-testid="signature-recipient-email" type="email" value={email} onChange={event=>onEmailChange(event.target.value)} required/></label>
  </>;
}

export function SignatureStaffIdentityField({name,confirmed,onNameChange,onConfirm,onEdit}:{name:string;confirmed:boolean;onNameChange:(value:string)=>void;onConfirm:()=>void;onEdit:()=>void}){
  if(confirmed)return <div className="confirmed-signer-identity"><p><strong>{name}</strong><br/><small>Staff identity confirmed for this signing cycle.</small></p><button type="button" className="secondary" onClick={onEdit}>Change staff identity</button></div>;
  const valid=name.trim().length>=2;
  return <div className="staff-identity-confirmation">
    <label>Organization staff name<input data-testid="signature-staff-name" autoFocus value={name} onChange={event=>onNameChange(event.target.value)} minLength={2} maxLength={200} required/></label>
    <button data-testid="confirm-staff-identity" type="button" disabled={!valid} onClick={onConfirm}>Confirm staff identity</button>
    <small>Typing does not save this identity. Confirm the complete name before continuing.</small>
  </div>;
}
