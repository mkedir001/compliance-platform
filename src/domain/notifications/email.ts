import { SendEmailCommand, SESv2Client, type SendEmailCommandInput, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import { InvokeCommand, LambdaClient, type InvokeCommandOutput } from "@aws-sdk/client-lambda";
import { z } from "zod";
import { emailEnvironment, type EmailEnvironment } from "@/lib/env";

export type ComplianceEmail={to:string;subject:string;text:string;html?:string;actionHref?:string|null};
export type EmailSendResult={messageId:string;acceptedAt?:Date};
export interface EmailProvider{name:string;configured:boolean;send(message:ComplianceEmail):Promise<EmailSendResult>}
export class EmailDeliveryError extends Error{constructor(message:string,public readonly retryable=true,public readonly code="EMAIL_DELIVERY_FAILED"){super(message)}}
const addressSchema=z.string().trim().toLowerCase().email();
const headerSchema=z.string().trim().min(1).max(200).refine(value=>!/[\r\n]/.test(value));
function mailbox(address:string,name?:string){const parsed=addressSchema.parse(address);if(!name)return parsed;const safe=headerSchema.parse(name).replaceAll("\\","\\\\").replaceAll('"','\\"');return `"${safe}" <${parsed}>`}

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
      FromEmailAddress:mailbox(this.config.from,this.config.fromName),
      Destination:{ToAddresses:[addressSchema.parse(message.to)]},
      ReplyToAddresses:this.config.replyTo?[addressSchema.parse(this.config.replyTo)]:undefined,
      Content:{Simple:{Subject:{Data:headerSchema.parse(message.subject),Charset:"UTF-8"},Body:{Text:{Data:message.text,Charset:"UTF-8"},...(message.html?{Html:{Data:message.html,Charset:"UTF-8"}}:{})}}},
    };
    try{const response=await this.client.send(new SendEmailCommand(input));if(!response.MessageId)throw new EmailDeliveryError("SES did not accept the email",true,"SES_ACCEPTANCE_MISSING");return{messageId:response.MessageId,acceptedAt:new Date()}}
    catch(error){if(error instanceof EmailDeliveryError)throw error;const candidate=error as{$retryable?:unknown;$metadata?:{httpStatusCode?:number};name?:string},status=candidate.$metadata?.httpStatusCode,retryable=Boolean(candidate.$retryable)||status===429||Boolean(status&&status>=500);throw new EmailDeliveryError("SES email delivery failed",retryable,candidate.name?`SES_${candidate.name.toUpperCase().replace(/[^A-Z0-9_]/g,"_")}`:"SES_DELIVERY_FAILED")}
  }
}

type PauboxConfig=Extract<EmailEnvironment,{provider:"paubox"}>;
export type LambdaClientLike={send(command:InvokeCommand):Promise<InvokeCommandOutput>};
const relayResponseSchema=z.discriminatedUnion("accepted",[
  z.object({accepted:z.literal(true),messageId:z.string().trim().min(1).max(200),acceptedAt:z.string().datetime()}).strict(),
  z.object({accepted:z.literal(false),code:z.string().regex(/^PAUBOX_[A-Z0-9_]+$/),retryable:z.boolean()}).strict(),
]);
export function pauboxLambdaClientOptions(config:PauboxConfig){return{region:config.region,maxAttempts:1}}
export class PauboxRelayEmailProvider implements EmailProvider{
  name="paubox";configured=true;private readonly client:LambdaClientLike;
  constructor(private readonly config:PauboxConfig,client?:LambdaClientLike){this.client=client??new LambdaClient(pauboxLambdaClientOptions(config))}
  async send(message:ComplianceEmail):Promise<EmailSendResult>{
    const payload={version:1,from:addressSchema.parse(this.config.from),fromName:this.config.fromName?headerSchema.parse(this.config.fromName):undefined,replyTo:this.config.replyTo?addressSchema.parse(this.config.replyTo):undefined,to:addressSchema.parse(message.to),subject:headerSchema.parse(message.subject),text:z.string().min(1).max(100_000).parse(message.text),html:message.html?z.string().min(1).max(200_000).parse(message.html):undefined};
    let invoked:InvokeCommandOutput;try{invoked=await this.client.send(new InvokeCommand({FunctionName:this.config.relayFunctionName,InvocationType:"RequestResponse",Payload:Buffer.from(JSON.stringify(payload))}))}catch{throw new EmailDeliveryError("Paubox relay unavailable",true,"PAUBOX_RELAY_UNAVAILABLE")}
    if(invoked.FunctionError||!invoked.Payload)throw new EmailDeliveryError("Paubox relay failed",true,"PAUBOX_RELAY_FAILED");
    let parsed:z.infer<typeof relayResponseSchema>;try{parsed=relayResponseSchema.parse(JSON.parse(Buffer.from(invoked.Payload).toString("utf8")))}catch{throw new EmailDeliveryError("Paubox relay returned an invalid response",true,"PAUBOX_RELAY_RESPONSE_INVALID")}
    if(!parsed.accepted)throw new EmailDeliveryError("Paubox email delivery failed",parsed.retryable,parsed.code);return{messageId:parsed.messageId,acceptedAt:new Date(parsed.acceptedAt)};
  }
}

export function configuredEmailProvider(source:NodeJS.ProcessEnv|Record<string,string|undefined>=process.env):EmailProvider{const config=emailEnvironment(source);if(!config)return new LocalNoopEmailProvider();if(config.provider==="ses")return new SesEmailProvider(config);if(config.provider==="paubox")return new PauboxRelayEmailProvider(config);return new HttpEmailProvider(config)}
