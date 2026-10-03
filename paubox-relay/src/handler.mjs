import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const API_URL="https://api.paubox.com/v1/email/messages";
const ALLOWED_FROM="signatures@email.waldah.com";
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE=/^[A-Z0-9_]+$/;

function exactKeys(value,allowed){return value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key))}
function text(value,min,max){return typeof value==="string"&&value.length>=min&&value.length<=max&&!/[\r\n]/.test(value)}
function email(value){return typeof value==="string"&&value.length<=320&&EMAIL.test(value)}
function validate(event){
  if(!exactKeys(event,["version","from","fromName","replyTo","to","subject","text","html"])||event.version!==1||event.from!==ALLOWED_FROM||!email(event.to)||!text(event.subject,1,200)||typeof event.text!=="string"||event.text.length<1||event.text.length>100_000||("fromName" in event&&!text(event.fromName,1,200))||("replyTo" in event&&!email(event.replyTo))||("html" in event&&(typeof event.html!=="string"||event.html.length<1||event.html.length>200_000)))throw new Error("INVALID_REQUEST");
  return event;
}
function result(accepted,value={}){return accepted?{accepted:true,messageId:value.messageId,acceptedAt:new Date().toISOString()}:{accepted:false,code:CODE.test(value.code??"")?value.code:"PAUBOX_PROVIDER_FAILURE",retryable:Boolean(value.retryable)}}
function log(entry){console.log(JSON.stringify({timestamp:new Date().toISOString(),operation:"paubox-transactional-email",...entry}))}
function providerFailure(status){if(status===401)return{code:"PAUBOX_AUTHENTICATION_REJECTED",retryable:false};if(status===403)return{code:"PAUBOX_RESTRICTED",retryable:false};if(status===429)return{code:"PAUBOX_RATE_LIMITED",retryable:true};if(status>=500)return{code:"PAUBOX_TEMPORARY_FAILURE",retryable:true};if(status===400||status===404||status===422)return{code:"PAUBOX_PERMANENT_REJECTION",retryable:false};return{code:"PAUBOX_PROVIDER_REJECTION",retryable:false}}

export function createHandler({secrets=new SecretsManagerClient({}),fetchImpl=fetch,environment=process.env,logger=log}={}){
  let credential;
  async function apiKey(){if(credential)return credential;if(!environment.PAUBOX_SECRET_ID)throw new Error("CONFIGURATION_UNAVAILABLE");const response=await secrets.send(new GetSecretValueCommand({SecretId:environment.PAUBOX_SECRET_ID})),value=response.SecretString?.trim();if(!value||value.length<20)throw new Error("CONFIGURATION_UNAVAILABLE");credential=value;return credential}
  return async function handler(event,context={}){
    const requestId=context.awsRequestId??"unavailable";let message;
    try{message=validate(event)}catch{logger({level:"warn",outcome:"rejected",requestId,errorCode:"PAUBOX_REQUEST_INVALID"});return result(false,{code:"PAUBOX_REQUEST_INVALID",retryable:false})}
    try{
      const key=await apiKey(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8_000);let response;
      try{response=await fetchImpl(API_URL,{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({data:{message:{recipients:[message.to],headers:{subject:message.subject,from:message.from,...(message.replyTo?{"reply-to":message.replyTo}:{})},content:{"text/plain":message.text,...(message.html?{"text/html":message.html}:{})}}}}),signal:controller.signal})}finally{clearTimeout(timeout)}
      if(!response.ok){const failure=providerFailure(response.status);logger({level:"warn",outcome:"provider-rejected",requestId,errorCode:failure.code,providerStatus:response.status});return result(false,failure)}
      let body;try{body=await response.json()}catch{body=null}if(!exactKeys(body,["sourceTrackingId","customHeaders","data"])||typeof body.sourceTrackingId!=="string"||body.sourceTrackingId.length<1||body.sourceTrackingId.length>200){logger({level:"error",outcome:"malformed-response",requestId,errorCode:"PAUBOX_RESPONSE_INVALID"});return result(false,{code:"PAUBOX_RESPONSE_INVALID",retryable:true})}
      logger({level:"info",outcome:"accepted",requestId});return result(true,{messageId:body.sourceTrackingId});
    }catch(error){const timeout=error?.name==="AbortError";logger({level:"error",outcome:"dependency-failed",requestId,errorCode:timeout?"PAUBOX_TIMEOUT":"PAUBOX_RELAY_DEPENDENCY_UNAVAILABLE"});return result(false,{code:timeout?"PAUBOX_TIMEOUT":"PAUBOX_RELAY_DEPENDENCY_UNAVAILABLE",retryable:true})}
  };
}

export const handler=createHandler();
