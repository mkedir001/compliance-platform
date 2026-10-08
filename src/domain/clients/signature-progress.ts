export type SignatureProgressSigner = {
  required?: boolean;
  status: string;
  signedAt: string | Date | null;
  signatureMethod: string | null;
  verificationMethod: string | null;
  evidenceValid?: boolean;
};

export function projectSignatureProgress<T extends SignatureProgressSigner>(signers: readonly T[]) {
  const required = signers.filter(signer => signer.required !== false);
  const completed = required.filter(signer => signer.evidenceValid ?? (
    signer.status === "SIGNED" &&
    Boolean(signer.signedAt && signer.signatureMethod && signer.verificationMethod)
  )).length;
  return { signers: required, completed, pending: required.length - completed, total: required.length };
}
