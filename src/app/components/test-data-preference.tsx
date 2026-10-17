"use client";
import { useCallback, useEffect, useState } from "react";

const keyFor = (organizationId: string) => `waldah:show-test-data:${organizationId}`;
const EVENT = "waldah:test-data-preference";

function read(organizationId: string) {
  try { return window.localStorage.getItem(keyFor(organizationId)) === "1"; } catch { return false; }
}

/** Per-browser, per-organization preference for showing synthetic records. The server still requires organization.manage. */
export function useShowTestData(organizationId: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!organizationId) return;
    const sync = () => setValue(read(organizationId));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(EVENT, sync); };
  }, [organizationId]);
  const update = useCallback((next: boolean) => {
    try { window.localStorage.setItem(keyFor(organizationId), next ? "1" : "0"); } catch { /* preference stays in memory only */ }
    setValue(next);
    window.dispatchEvent(new Event(EVENT));
  }, [organizationId]);
  return [value, update];
}

export function TestDataIndicator() {
  return <a className="test-data-indicator" href="/admin/setup/test-data-cleanup">Test data shown · Change in Settings</a>;
}
