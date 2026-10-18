"use client";
import { useEffect,useState } from "react";
import { loadSecurePdf } from "./pdf-preview-client";

export function DocumentPdfViewer({src,title,downloadSrc=src,downloadLabel="Download original"}:{src:string;title:string;downloadSrc?:string;downloadLabel?:string}){
  const[key,setKey]=useState(0),[objectUrl,setObjectUrl]=useState<string>(),[loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{const controller=new AbortController();let url:string|undefined;setObjectUrl(undefined);setLoaded(false);setFailed(false);void loadSecurePdf(src,controller.signal).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setObjectUrl(url)}).catch(()=>{if(!controller.signal.aborted)setFailed(true)});return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[src,key]);
  function retry(){setKey(value=>value+1)}
  return <div className="authoritative-document-preview" aria-busy={!loaded&&!failed}>
    {!loaded&&!failed?<div className="pdf-viewer-state" role="status">Loading secure PDF…</div>:null}
    {failed?<div className="pdf-viewer-state" role="alert"><strong>PDF preview unavailable</strong><p>The secure preview request failed or did not return a valid PDF. The original record has not been changed.</p><div><button type="button" onClick={retry}>Retry preview</button><a className="button secondary" href={downloadSrc}>{downloadLabel}</a></div></div>:null}
    {objectUrl?<iframe key={objectUrl} title={title} src={objectUrl} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} className={failed?"pdf-frame-failed":""}/>:null}
    {loaded?<div className="pdf-viewer-fallback">Preview blank or incomplete? <a href={downloadSrc}>{downloadLabel}</a>.</div>:null}
  </div>
}
