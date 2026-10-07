export type SignatureFieldErrors = { name?: string; drawing?: string; consent?: string };

export function validateSignatureCapture(input: { name: string; method: "TYPED" | "DRAWN"; consent: boolean; hasDrawing: boolean }): SignatureFieldErrors {
  const errors: SignatureFieldErrors = {};
  if (!input.name.trim()) errors.name = "Enter the printed signer name.";
  if (input.method === "DRAWN" && !input.hasDrawing) errors.drawing = "Draw a signature before continuing.";
  if (!input.consent) errors.consent = "Review and accept the electronic signature consent.";
  return errors;
}

export function hasSignatureErrors(errors: SignatureFieldErrors) {
  return Boolean(errors.name || errors.drawing || errors.consent);
}

export function serializeDrawnSignature(canvas: HTMLCanvasElement | null, hasDrawing: boolean) {
  return canvas && hasDrawing ? canvas.toDataURL("image/png") : undefined;
}
