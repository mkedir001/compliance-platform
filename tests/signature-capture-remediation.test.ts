import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hasSignatureErrors, serializeDrawnSignature, validateSignatureCapture } from "@/app/sign/[token]/signature-capture";
import { parseDrawnSignature } from "@/domain/clients/signatures";

const ink="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
const blank="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

describe("drawn signature capture remediation",()=>{
  it("reports signer-name, blank-drawing, and consent errors at field level",()=>{const errors=validateSignatureCapture({name:" ",method:"DRAWN",consent:false,hasDrawing:false});expect(errors).toEqual({name:"Enter the printed signer name.",drawing:"Draw a signature before continuing.",consent:"Review and accept the electronic signature consent."});expect(hasSignatureErrors(errors)).toBe(true)});
  it("keeps typed signing independent of canvas state",()=>expect(validateSignatureCapture({name:"Synthetic Signer",method:"TYPED",consent:true,hasDrawing:false})).toEqual({}));
  it("serializes only an explicitly marked drawing",()=>{const toDataURL=vi.fn(()=>ink),canvas={toDataURL} as unknown as HTMLCanvasElement;expect(serializeDrawnSignature(canvas,false)).toBeUndefined();expect(serializeDrawnSignature(canvas,true)).toBe(ink);expect(toDataURL).toHaveBeenCalledTimes(1)});
  it("rejects a transparent PNG server-side and accepts visible ink",()=>{expect(()=>parseDrawnSignature(blank)).toThrow(/draw a signature/i);expect(parseDrawnSignature(ink).length).toBeGreaterThan(0)});
  it("exposes immediate pending, duplicate prevention, actionable errors, and the resulting rendition",()=>{const source=readFileSync(join(process.cwd(),"src/app/sign/[token]/signing-experience.tsx"),"utf8");expect(source).toContain("setBusy(true)");expect(source).toContain("disabled={busy}");expect(source).toContain("Applying signature…");expect(source).toContain("fieldErrors.name");expect(source).toContain("fieldErrors.drawing");expect(source).toContain("fieldErrors.consent");expect(source).toContain("completed=true&rendition=");expect(source).not.toContain("setTimeout")});
});
