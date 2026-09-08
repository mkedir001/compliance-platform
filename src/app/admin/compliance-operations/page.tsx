"use client";
import { useState } from "react";
export default function Operations(){
 const[userId,setUserId]=useState(""),[organizationId,setOrganizationId]=useState(""),[employeeId,setEmployeeId]=useState(""),[data,setData]=useState<unknown>(null),[error,setError]=useState("");
 const headers={"x-dev-user-id":userId,"content-type":"application/json"};
 async function load(path:string,options?:RequestInit){const r=await fetch(`/api/organizations/${organizationId}${path}`,{headers,...options}),b=await r.json();if(r.ok){setData(b);setError("")}else setError(b.error)}
 return <main><h1>Compliance operations</h1><p>Functional Phase 5 console for onboarding, employee evidence, scope readiness, and operational counts.</p><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder="Administrator user ID"/><input value={organizationId} onChange={e=>setOrganizationId(e.target.value)} placeholder="Organization ID"/><input value={employeeId} onChange={e=>setEmployeeId(e.target.value)} placeholder="Employee ID"/><button onClick={()=>load("/operations")}>Operations summary</button><button onClick={()=>load(`/employees/${employeeId}/profile`)}>Employee profile</button><button onClick={()=>load(`/employees/${employeeId}/onboarding`,{method:"POST",body:"{}"})}>Start onboarding</button><button onClick={()=>load(`/employees/${employeeId}/readiness`,{method:"POST",body:"{}"})}>Reevaluate readiness</button><p>{error}</p>{data?<pre>{JSON.stringify(data,null,2)}</pre>:null}</main>;
}
