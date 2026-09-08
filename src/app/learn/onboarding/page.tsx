"use client";
import { useState } from "react";
export default function MyOnboarding(){
 const[userId,setUserId]=useState(""),[organizationId,setOrganizationId]=useState(""),[data,setData]=useState<unknown>(null),[error,setError]=useState("");
 async function load(path:string){const r=await fetch(`/api/organizations/${organizationId}/my/${path}`,{headers:{"x-dev-user-id":userId}}),b=await r.json();if(r.ok){setData(b);setError("")}else setError(b.error)}
 return <main><h1>My onboarding and policies</h1><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder="User ID"/><input value={organizationId} onChange={e=>setOrganizationId(e.target.value)} placeholder="Organization ID"/><button onClick={()=>load("onboarding")}>Onboarding progress</button><button onClick={()=>load("policies")}>Assigned policies</button><p>{error}</p>{data?<pre>{JSON.stringify(data,null,2)}</pre>:null}</main>;
}
