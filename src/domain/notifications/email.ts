import { SendEmailCommand, SESv2Client, type SendEmailCommandInput, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import { InvokeCommand, LambdaClient, type InvokeCommandOutput } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { emailEnvironment, workforceEmailEnvironment, type EmailEnvironment } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type EmailDeliveryContext={organizationId:string;logicalType:string;logicalId:string;purpose:EmailCommunicationPurpose};
export type ComplianceEmail={to:string;fromName?:string;subject:string;text:string;html?:string;actionHref?:string|null;deliveryContext?:EmailDeliveryContext};
export type EmailSendResult={messageId:string;acceptedAt?:Date;provider?:string};
export interface EmailProvider{name:string;configured:boolean;send(message:ComplianceEmail):Promise<EmailSendResult>}
export type EmailCommunicationPurpose="CLIENT_SECURE"|"WORKFORCE_TRANSACTIONAL";
export type EmailFailureClassification="DEFINITIVELY_NOT_ACCEPTED"|"RETRYABLE_TRANSPORT_FAILURE"|"CAPACITY_OR_QUOTA_FAILURE"|"AMBIGUOUS_OUTCOME"|"PERMANENT_RECIPIENT_FAILURE"|"POLICY_OR_VALIDATION_FAILURE"|"AUTH_OR_CONFIGURATION_FAILURE";
export class EmailDeliveryError extends Error{constructor(message:string,public readonly retryable=true,public readonly code="EMAIL_DELIVERY_FAILED",public readonly classification:EmailFailureClassification=retryable?"RETRYABLE_TRANSPORT_FAILURE":"DEFINITIVELY_NOT_ACCEPTED"){super(message)}}
const addressSchema=z.string().trim().toLowerCase().email();
const headerSchema=z.string().trim().min(1).max(200).refine(value=>!/[\r\n]/.test(value));
function mailbox(address:string,name?:string){const parsed=addressSchema.parse(address);if(!name)return parsed;const safe=headerSchema.parse(name).replaceAll("\\","\\\\").replaceAll('"','\\"');return `"${safe}" <${parsed}>`}
function relayPayload(config:{from:string;fromName?:string;replyTo?:string},message:ComplianceEmail){try{return{version:1,from:addressSchema.parse(config.from),fromName:message.fromName?headerSchema.parse(message.fromName):config.fromName?headerSchema.parse(config.fromName):undefined,replyTo:config.replyTo?addressSchema.parse(config.replyTo):undefined,to:addressSchema.parse(message.to),subject:headerSchema.parse(message.subject),text:z.string().min(1).max(100_000).parse(message.text),html:message.html?z.string().min(1).max(200_000).parse(message.html):undefined}}catch{throw new EmailDeliveryError("Email request is invalid",false,"EMAIL_REQUEST_INVALID","POLICY_OR_VALIDATION_FAILURE")}}

export class LocalNoopEmailProvider implements EmailProvider{name="local-noop";configured=false;async send():Promise<EmailSendResult>{throw new EmailDeliveryError("Live email provider is not configured",false,"EMAIL_PROVIDER_NOT_CONFIGURED")}}

export class HttpEmailProvider implements EmailProvider{
  name="http-email";configured=true;
  constructor(private readonly config:{apiUrl:string;apiToken:string;from:string;fromName?:string;replyTo?:string}){}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    const to=addressSchema.parse(message.to);let response:Response;
    try{const actionHref=message.actionHref&&process.env.APP_BASE_URL?new URL(message.actionHref,process.env.APP_BASE_URL).toString():message.actionHref;response=await fetch(this.config.apiUrl,{method:"POST",headers:{authorization:`Bearer ${this.config.apiToken}`,"content-type":"application/json"},body:JSON.stringify({from:mailbox(this.config.from,this.config.fromName),replyTo:this.config.replyTo?addressSchema.parse(this.config.replyTo):undefined,to,subject:message.subject,text:message.text,html:message.html,actionHref}),signal:AbortSignal.timeout(5000)})}catch{throw new EmailDeliveryError("Email provider unavailable",true,"EMAIL_PROVIDER_UNAVAILABLE")}
    if(!response.ok)throw new EmailDeliveryError("Email provider rejected delivery",response.status===429||response.status>=500,`EMAIL_PROVIDER_${response.status}`);
    const body=await response.json()as{id?:string;messageId?:string};return{messageId:body.messageId??body.id??"accepted",acceptedAt:new Date()};
  }
}

export type SesClientLike={send(command:SendEmailCommand):Promise<SendEmailCommandOutput>};
type SesConfig=Extract<EmailEnvironment,{provider:"ses"}>;
export function sesClientOptions(config:SesConfig){return{region:config.region}}
export class SesEmailProvider implements EmailProvider{
  name="ses";configured=true;
  private readonly client:SesClientLike;
  constructor(private readonly config:SesConfig,client?:SesClientLike){this.client=client??new SESv2Client(sesClientOptions(config))}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    const input:SendEmailCommandInput={
      FromEmailAddress:mailbox(this.config.from,message.fromName??this.config.fromName),
      Destination:{ToAddresses:[addressSchema.parse(message.to)]},
      ReplyToAddresses:this.config.replyTo?[addressSchema.parse(this.config.replyTo)]:undefined,
      Content:{Simple:{Subject:{Data:headerSchema.parse(message.subject),Charset:"UTF-8"},Body:{Text:{Data:message.text,Charset:"UTF-8"},...(message.html?{Html:{Data:message.html,Charset:"UTF-8"}}:{})}}},
    };
    try{const response=await this.client.send(new SendEmailCommand(input));if(!response.MessageId)throw new EmailDeliveryError("SES did not accept the email",true,"SES_ACCEPTANCE_MISSING");return{messageId:response.MessageId,acceptedAt:new Date()}}
    catch(error){if(error instanceof EmailDeliveryError)throw error;const candidate=error as{$retryable?:unknown;$metadata?:{httpStatusCode?:number};name?:string},status=candidate.$metadata?.httpStatusCode,retryable=Boolean(candidate.$retryable)||status===429||Boolean(status&&status>=500);throw new EmailDeliveryError("SES email delivery failed",retryable,candidate.name?`SES_${candidate.name.toUpperCase().replace(/[^A-Z0-9_]/g,"_")}`:"SES_DELIVERY_FAILED")}
  }
}

type PauboxConfig=Extract<EmailEnvironment,{provider:"paubox"}>;
type MailgunConfig=Extract<EmailEnvironment,{provider:"mailgun"}>;
export type LambdaClientLike={send(command:InvokeCommand):Promise<InvokeCommandOutput>};
const relayResponseSchema=z.discriminatedUnion("accepted",[
  z.object({accepted:z.literal(true),messageId:z.string().trim().min(1).max(200),acceptedAt:z.string().datetime()}).strict(),
  z.object({accepted:z.literal(false),code:z.string().regex(/^[A-Z][A-Z0-9_]+$/),retryable:z.boolean(),classification:z.enum(["DEFINITIVELY_NOT_ACCEPTED","RETRYABLE_TRANSPORT_FAILURE","CAPACITY_OR_QUOTA_FAILURE","AMBIGUOUS_OUTCOME","PERMANENT_RECIPIENT_FAILURE","POLICY_OR_VALIDATION_FAILURE","AUTH_OR_CONFIGURATION_FAILURE"]).optional()}).strict(),
]);
function legacyClassification(code:string,retryable:boolean):EmailFailureClassification{if(code.includes("RATE_LIMIT")||code.includes("QUOTA")||code.includes("CAPACITY"))return"CAPACITY_OR_QUOTA_FAILURE";if(code.includes("AUTH")||code.includes("RESTRICTED")||code.includes("CONFIGURATION"))return"AUTH_OR_CONFIGURATION_FAILURE";if(code.includes("REQUEST_INVALID")||code.includes("VALIDATION")||code.includes("PERMANENT_REJECTION"))return"POLICY_OR_VALIDATION_FAILURE";return retryable?"RETRYABLE_TRANSPORT_FAILURE":"DEFINITIVELY_NOT_ACCEPTED"}
export function pauboxLambdaClientOptions(config:PauboxConfig){return{region:config.region,maxAttempts:1}}
export class PauboxRelayEmailProvider implements EmailProvider{
  name="paubox";configured=true;private readonly client:LambdaClientLike;
  constructor(private readonly config:PauboxConfig,client?:LambdaClientLike){this.client=client??new LambdaClient(pauboxLambdaClientOptions(config))}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    const payload=relayPayload(this.config,message);
    let invoked:InvokeCommandOutput;try{invoked=await this.client.send(new InvokeCommand({FunctionName:this.config.relayFunctionName,InvocationType:"RequestResponse",Payload:Buffer.from(JSON.stringify(payload))}))}catch{throw new EmailDeliveryError("Paubox relay outcome is unknown",false,"PAUBOX_RELAY_UNAVAILABLE","AMBIGUOUS_OUTCOME")}
    if(invoked.FunctionError||!invoked.Payload)throw new EmailDeliveryError("Paubox relay outcome is unknown",false,"PAUBOX_RELAY_FAILED","AMBIGUOUS_OUTCOME");
    let parsed:z.infer<typeof relayResponseSchema>;try{parsed=relayResponseSchema.parse(JSON.parse(Buffer.from(invoked.Payload).toString("utf8")))}catch{throw new EmailDeliveryError("Paubox relay outcome is unknown",false,"PAUBOX_RELAY_RESPONSE_INVALID","AMBIGUOUS_OUTCOME")}
    if(!parsed.accepted)throw new EmailDeliveryError("Paubox email delivery failed",parsed.retryable,parsed.code,parsed.classification??legacyClassification(parsed.code,parsed.retryable));return{messageId:parsed.messageId,acceptedAt:new Date(parsed.acceptedAt),provider:this.name};
  }
}

export function mailgunLambdaClientOptions(config:MailgunConfig){return{region:config.region,maxAttempts:1}}
export class MailgunRelayEmailProvider implements EmailProvider{
  name="mailgun";configured=true;private readonly client:LambdaClientLike;
  constructor(private readonly config:MailgunConfig,client?:LambdaClientLike){this.client=client??new LambdaClient(mailgunLambdaClientOptions(config))}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    const payload=relayPayload(this.config,message);
    let invoked:InvokeCommandOutput;try{invoked=await this.client.send(new InvokeCommand({FunctionName:this.config.relayFunctionName,InvocationType:"RequestResponse",Payload:Buffer.from(JSON.stringify(payload))}))}catch{throw new EmailDeliveryError("Mailgun relay outcome is unknown",false,"MAILGUN_RELAY_UNAVAILABLE","AMBIGUOUS_OUTCOME")}
    if(invoked.FunctionError||!invoked.Payload)throw new EmailDeliveryError("Mailgun relay outcome is unknown",false,"MAILGUN_RELAY_FAILED","AMBIGUOUS_OUTCOME");
    let parsed:z.infer<typeof relayResponseSchema>;try{parsed=relayResponseSchema.parse(JSON.parse(Buffer.from(invoked.Payload).toString("utf8")))}catch{throw new EmailDeliveryError("Mailgun relay outcome is unknown",false,"MAILGUN_RELAY_RESPONSE_INVALID","AMBIGUOUS_OUTCOME")}
    if(!parsed.accepted)throw new EmailDeliveryError("Mailgun email delivery failed",parsed.retryable,parsed.code,parsed.classification??legacyClassification(parsed.code,parsed.retryable));return{messageId:parsed.messageId,acceptedAt:new Date(parsed.acceptedAt),provider:this.name};
  }
}

export type EmailAttemptDecision="ACCEPTED"|"RETRY_PRIMARY"|"FAILOVER"|"STOPPED";
export type EmailAttemptObserver=(event:{context:EmailDeliveryContext;sequence:number;provider:string;outcome:"ACCEPTED"|"FAILED";decision:EmailAttemptDecision;classification?:EmailFailureClassification;code?:string;messageId?:string;attemptedAt:Date;acceptedAt?:Date;final:boolean})=>Promise<void>;
export const persistEmailAttempt:EmailAttemptObserver=async event=>{
  await prisma.$transaction(async tx=>{
    const communication=await tx.emailCommunication.upsert({where:{organizationId_purpose_logicalType_logicalId:{organizationId:event.context.organizationId,purpose:event.context.purpose,logicalType:event.context.logicalType,logicalId:event.context.logicalId}},create:{organizationId:event.context.organizationId,purpose:event.context.purpose,logicalType:event.context.logicalType,logicalId:event.context.logicalId},update:{}});
    const latest=await tx.emailProviderAttempt.aggregate({where:{communicationId:communication.id},_max:{sequence:true}}),sequence=(latest._max.sequence??0)+1;
    await tx.emailProviderAttempt.create({data:{communicationId:communication.id,sequence,provider:event.provider,outcome:event.outcome,decision:event.decision,failureClassification:event.classification,errorCode:event.code,providerMessageId:event.messageId,attemptedAt:event.attemptedAt,acceptedAt:event.acceptedAt}});
    await tx.emailCommunication.update({where:{id:communication.id},data:event.outcome==="ACCEPTED"?{state:"PROVIDER_ACCEPTED",selectedProvider:event.provider,providerMessageId:event.messageId,providerAcceptedAt:event.acceptedAt}:{state:event.final?(event.classification==="AMBIGUOUS_OUTCOME"?"AMBIGUOUS":"FAILED"):"PENDING",selectedProvider:event.provider}});
  });
};
export class PurposeRoutedEmailProvider implements EmailProvider{
  configured:boolean;name:string;
  constructor(private readonly purpose:EmailCommunicationPurpose,private readonly primary:EmailProvider,private readonly secondary?:EmailProvider,private readonly observe?:EmailAttemptObserver,private readonly retryPolicy:{maxPrimaryRetries:number;baseDelayMs:number;sleep:(milliseconds:number)=>Promise<void>}={maxPrimaryRetries:1,baseDelayMs:250,sleep:milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))}){this.configured=primary.configured;this.name=secondary?`${primary.name}->${secondary.name}`:primary.name}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    if(message.deliveryContext&&message.deliveryContext.purpose!==this.purpose)throw new EmailDeliveryError("Email purpose does not match delivery policy",false,"EMAIL_PURPOSE_MISMATCH","POLICY_OR_VALIDATION_FAILURE");
    const providers=[this.primary,...(this.secondary?.configured?[this.secondary]:[])];
    let sequence=0;
    for(let providerIndex=0;providerIndex<providers.length;providerIndex++){
      const provider=providers[providerIndex],primary=providerIndex===0,maxRetries=primary?this.retryPolicy.maxPrimaryRetries:0;
      for(let retry=0;retry<=maxRetries;retry++){
        const attemptedAt=new Date();sequence++;
        try{const result=await provider.send(message),accepted={...result,provider:result.provider??provider.name};if(message.deliveryContext&&this.observe)await this.observe({context:message.deliveryContext,sequence,provider:accepted.provider!,outcome:"ACCEPTED",decision:"ACCEPTED",messageId:accepted.messageId,attemptedAt,acceptedAt:accepted.acceptedAt??new Date(),final:true});return accepted}
        catch(error){
          const failure=error instanceof EmailDeliveryError?error:new EmailDeliveryError("Email provider outcome is unknown",false,"EMAIL_PROVIDER_UNKNOWN","AMBIGUOUS_OUTCOME"),retryablePrimary=primary&&failure.classification==="RETRYABLE_TRANSPORT_FAILURE"&&retry<maxRetries,eligibleForFailover=["DEFINITIVELY_NOT_ACCEPTED","RETRYABLE_TRANSPORT_FAILURE","CAPACITY_OR_QUOTA_FAILURE"].includes(failure.classification),canFailover=providerIndex<providers.length-1&&eligibleForFailover,decision:EmailAttemptDecision=retryablePrimary?"RETRY_PRIMARY":canFailover?"FAILOVER":"STOPPED",final=decision==="STOPPED";
          if(message.deliveryContext&&this.observe)await this.observe({context:message.deliveryContext,sequence,provider:provider.name,outcome:"FAILED",decision,classification:failure.classification,code:failure.code,attemptedAt,final});
          if(retryablePrimary){await this.retryPolicy.sleep(this.retryPolicy.baseDelayMs*2**retry);continue}
          if(canFailover)break;
          throw failure;
        }
      }
    }
    throw new EmailDeliveryError("No email provider is configured",false,"EMAIL_PROVIDER_NOT_CONFIGURED","AUTH_OR_CONFIGURATION_FAILURE");
  }
}

export function providerFromConfig(config:EmailEnvironment):EmailProvider{if(config.provider==="ses")return new SesEmailProvider(config);if(config.provider==="paubox")return new PauboxRelayEmailProvider(config);if(config.provider==="mailgun")return new MailgunRelayEmailProvider(config);return new HttpEmailProvider(config)}
export function configuredEmailProvider(source:NodeJS.ProcessEnv|Record<string,string|undefined>=process.env):EmailProvider{const config=emailEnvironment(source);return config?providerFromConfig(config):new LocalNoopEmailProvider()}
export function configuredEmailProviderForPurpose(purpose:EmailCommunicationPurpose,source:NodeJS.ProcessEnv|Record<string,string|undefined>=process.env):EmailProvider{
  if(purpose==="CLIENT_SECURE"){
    const primary=source.AWS_REGION&&source.MAILGUN_RELAY_FUNCTION_NAME&&source.MAILGUN_FROM?new MailgunRelayEmailProvider({provider:"mailgun",region:source.AWS_REGION,relayFunctionName:source.MAILGUN_RELAY_FUNCTION_NAME,from:source.MAILGUN_FROM,fromName:source.MAILGUN_FROM_NAME||undefined,replyTo:source.MAILGUN_REPLY_TO||undefined}):new LocalNoopEmailProvider(),configuredFallback=emailEnvironment(source),fallback=configuredFallback?.provider==="paubox"?new PauboxRelayEmailProvider(configuredFallback):undefined;
    return new PurposeRoutedEmailProvider(purpose,primary,fallback,persistEmailAttempt)
  }
  const config=workforceEmailEnvironment(source);
  if(!config)return new LocalNoopEmailProvider();
  return new PurposeRoutedEmailProvider(purpose,providerFromConfig(config),undefined,persistEmailAttempt);
}
