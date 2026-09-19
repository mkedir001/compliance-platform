export type OperationalEvent = { level: "info" | "warn" | "error"; operation: string; requestId?: string; organizationId?: string; actorUserId?: string; errorName?: string; errorCode?: string; message?: string };
type Sink = (event: OperationalEvent) => void | Promise<void>;
let sink: Sink | null = null;
export function registerObservabilitySink(next: Sink | null) { sink = next; }
export async function recordOperationalEvent(event: OperationalEvent) {
  const safe = { timestamp: new Date().toISOString(), ...event };
  if (event.level === "error") console.error(JSON.stringify(safe)); else if (event.level === "warn") console.warn(JSON.stringify(safe)); else console.info(JSON.stringify(safe));
  try { await sink?.(event); } catch { /* Monitoring must never break the application path. */ }
}
