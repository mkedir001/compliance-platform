import type { ComplianceStatus } from "@prisma/client";
import { deadlineSchemaV1, legalGraceSchemaV1, recurrenceSchemaV1 } from "../schemas/rules";

function localDateParts(date: Date, timeZone: string) { const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date); return Object.fromEntries(parts.map(p=>[p.type,p.value])); }
export function addCalendarDays(date: Date, days: number, timeZone: string): Date {
  // Prisma DATE values are represented as UTC-midnight ISO dates. Advance that
  // civil date directly; converting midnight through a western timezone first
  // would incorrectly move it to the prior calendar date.
  void timeZone; return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+days,date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds()));
}
export function calculateDeadline(triggerAt: Date, input: unknown, timeZone: string): Date | null {
  const d=deadlineSchemaV1.parse(input); if(d.type==="NO_FIXED_DEADLINE")return null; if(d.type==="WITHIN_HOURS")return new Date(triggerAt.getTime()+d.hours*3600000); if(d.type==="WITHIN_CALENDAR_DAYS")return addCalendarDays(triggerAt,d.days,timeZone); return new Date(triggerAt);
}
export function calculateLegalDelay(nominalDueAt: Date|null,input:unknown,evaluationDate:Date,timeZone:string,isAnnual=false):Date|null {
  if(!nominalDueAt||!input)return null; const g=legalGraceSchemaV1.parse(input); if(g.type==="NONE")return null;
  const local=localDateParts(nominalDueAt,timeZone), key=`${local.year}-${local.month}-${local.day}`; if(g.appliesTo==="ANNUAL_ONLY"&&!isAnnual)return null; if(g.effectiveFrom&&key<g.effectiveFrom)return null; if(g.effectiveUntil&&key>g.effectiveUntil)return null;
  void evaluationDate; return addCalendarDays(nominalDueAt,g.days,timeZone);
}
export function calculateStatus(now:Date,nominal:Date|null,delay:Date|null,hardBlockAt:Date|null):ComplianceStatus { if(hardBlockAt&&now>hardBlockAt)return "BLOCKED"; if(!nominal||now<=nominal)return "REQUIRED"; if(delay&&now<=delay)return "WITHIN_LEGAL_DELAY"; return "PAST_DUE"; }
export function nextAnnualDue(prior:Date,input:unknown){const r=recurrenceSchemaV1.parse(input);if(r.type==="NONE")return null;const next=new Date(prior);next.setUTCFullYear(next.getUTCFullYear()+1);return next;}
