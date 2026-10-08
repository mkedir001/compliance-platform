"use client";
import { useState } from "react";

export function DocumentPdfViewer({src,title}:{src:string;title:string}){
  const[key,setKey]=useState(0),[loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
  function retry(){setLoaded(false);setFailed(false);setKey(value=>value+1)}
  return <div className="authoritative-document-preview" aria-busy={!loaded&&!failed}>
    {!loaded&&!failed?<div className="pdf-viewer-state" role="status">Loading secure PDF…</div>:null}
    {failed?<div className="pdf-viewer-state" role="alert"><strong>PDF preview unavailable</strong><p>The original is still preserved. Retry the secure preview or open it directly.</p><div><button type="button" onClick={retry}>Retry</button><a className="button secondary" href={src}>Open PDF</a></div></div>:null}
    <iframe key={key} title={title} src={src} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} className={failed?"pdf-frame-failed":""}/>
  </div>
}
