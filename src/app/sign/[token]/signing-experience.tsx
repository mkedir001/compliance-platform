"use client";

import { useEffect, useRef, useState } from "react";

type Session = {
  organizationName: string;
  documentName: string;
  signerName: string;
  signerRole: string;
  consentVersion: string;
  consentText: string;
  expiresAt: string;
  status: string;
  renditionId: string;
  renditionHash: string;
  renditionSequence: number;
  returnUrl?: string;
};

export default function SigningExperience({ token, initialSession = null, initialError = "" }: { token: string; initialSession?: Session | null; initialError?: string }) {
  const [session, setSession] = useState<Session | null>(initialSession),
    [error, setError] = useState(initialError),
    [complete, setComplete] = useState(false),
    [method, setMethod] = useState<"TYPED" | "DRAWN">("TYPED"),
    [name, setName] = useState(initialSession?.signerName ?? ""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [reviewRequired, setReviewRequired] = useState(false),
    canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false);

  useEffect(() => {
    if (initialSession || initialError) return;
    fetch(`/api/sign/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value: Session) => {
        setSession(value);
        setName(value.signerName);
      })
      .catch(() => setError("This signing invitation is invalid, expired, or no longer available."));
  }, [token, initialSession, initialError]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) * event.currentTarget.width) / box.width, y: ((event.clientY - box.top) * event.currentTarget.height) / box.height };
  }
  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event), context = event.currentTarget.getContext("2d")!;
    context.beginPath();
    context.moveTo(p.x, p.y);
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const p = point(event), context = event.currentTarget.getContext("2d")!;
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#17251e";
    context.lineTo(p.x, p.y);
    context.stroke();
  }
  function clear() {
    const node = canvas.current;
    if (node) node.getContext("2d")?.clearRect(0, 0, node.width, node.height);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reviewRequired ? { confirmUpdatedRendition: true } : { consent, consentVersion: session.consentVersion, method, adoptedName: name, drawnSignature: method === "DRAWN" ? canvas.current?.toDataURL("image/png") : undefined }),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { returnUrl?: string;reviewRequired?:boolean;documentChanged?:boolean;signaturePreserved?:boolean;renditionId?:string;renditionHash?:string;renditionSequence?:number };
      setSession(current => current ? { ...current, returnUrl: result.returnUrl ?? current.returnUrl,renditionId:result.renditionId??current.renditionId,renditionHash:result.renditionHash??current.renditionHash,renditionSequence:result.renditionSequence??current.renditionSequence } : current);
      if(result.documentChanged){setReviewRequired(false);setConsent(false);setName(session.signerName);clear();setError("The document content changed. Review the updated document and provide a new signature and consent.");return}
      if(result.reviewRequired){setReviewRequired(true);setError("Another signer completed a signature while you were reviewing. Your signature and consent were preserved but not accepted. Review the updated document, then explicitly confirm completion.");return}
      setComplete(true);
    } catch {
      setError("Your signature could not be recorded. Confirm consent and signature details, or request a new invitation.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !session) return <main className="signing-shell"><section className="signing-card" role="alert"><p className="eyebrow">Secure document signing</p><h1>Invitation unavailable</h1><p>{error}</p></section></main>;
  if (!session) return <main className="signing-shell"><p>Loading secure signing session…</p></main>;
  if (complete) return <main className="signing-shell"><section className="signing-card"><p className="eyebrow">{session.organizationName}</p><h1>Signature recorded</h1>{session.returnUrl ? <><p>Your signature was recorded. Return to the client record to review persisted signer progress and document status.</p><a className="button" href={session.returnUrl}>Return to Documents</a></> : <p>Your signature was applied to the identified document. You may close this page.</p>}</section></main>;
  return <main className="signing-shell"><header><p className="eyebrow">{session.organizationName} · secure document signing</p><h1>{reviewRequired?"Review the updated document":"Review and sign"}</h1><p className="lede">{session.documentName}</p><p>Signing as <strong>{session.signerName}</strong> in the role <strong>{session.signerRole.replaceAll("_", " ").toLowerCase()}</strong>.</p></header><section className="document-review"><h2>Document review · rendition {session.renditionSequence}</h2><iframe key={session.renditionId} title={`Review ${session.documentName}`} src={`/api/sign/${encodeURIComponent(token)}/document?rendition=${encodeURIComponent(session.renditionId)}`}/></section><form className="signing-card" onSubmit={submit}>{reviewRequired?<p>Your previously captured signature remains unchanged and has not yet been accepted. Confirm only after reviewing this updated rendition.</p>:<><fieldset><legend>Choose a signature method</legend><label className="signature-choice"><input type="radio" checked={method === "TYPED"} onChange={() => setMethod("TYPED")}/> Type my signature</label><label className="signature-choice"><input type="radio" checked={method === "DRAWN"} onChange={() => setMethod("DRAWN")}/> Draw my signature</label></fieldset><label>Adopted signer name<input value={name} onChange={event => setName(event.target.value)} required autoComplete="name"/></label>{method === "DRAWN" ? <div><label htmlFor="signature-canvas">Drawn signature</label><canvas id="signature-canvas" ref={canvas} width={600} height={160} role="img" aria-label="Drawn signature canvas" tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={() => drawing.current = false} onPointerCancel={() => drawing.current = false}/><button type="button" className="secondary" onClick={clear}>Clear drawing</button></div> : <p className="typed-signature" aria-label={`Typed signature ${name}`}>{name}</p>}<label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required/> <span>{session.consentText}</span></label></>}{error ? <p role="alert">{error}</p> : null}<button disabled={busy || (!reviewRequired&&(!consent || !name.trim()))}>{busy ? "Applying signature…" : reviewRequired?"Review Updated Document & Complete Signature":"Adopt & Sign"}</button></form></main>;
}
