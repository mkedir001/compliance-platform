"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function ActionPopover({label,children,initialOpen=false}:{label:string;children:(close:()=>void)=>ReactNode;initialOpen?:boolean}){
  const [open,setOpen]=useState(initialOpen),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const close=useCallback(()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus())},[]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))close()},escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();close()}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>("select,input,button:not([aria-haspopup])")?.focus());
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape)};
  },[open,close]);
  return <div className="action-popover" ref={root}><button type="button" className="action-popover-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{label}</button>{open?<div className="action-popover-panel" role="dialog" aria-label={label}>{children(close)}</div>:null}</div>
}
