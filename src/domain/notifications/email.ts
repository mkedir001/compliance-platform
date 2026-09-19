export type ComplianceEmail={to:string;subject:string;text:string;actionHref?:string|null};
export type EmailSendResult={messageId:string};
export interface EmailProvider{name:string;configured:boolean;send(message:ComplianceEmail):Promise<EmailSendResult>}
export class EmailDeliveryError extends Error{constructor(message:string,public readonly retryable=true,public readonly code="EMAIL_DELIVERY_FAILED"){super(message)}}
export class LocalNoopEmailProvider implements EmailProvider{name="local-noop";configured=false;async send():Promise<EmailSendResult>{throw new EmailDeliveryError("Live email provider is not configured",false,"EMAIL_PROVIDER_NOT_CONFIGURED")}}
export function configuredEmailProvider():EmailProvider{return new LocalNoopEmailProvider()}
