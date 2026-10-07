export const portalTabs = ["dashboard", "employees", "training", "compliance", "policies", "evidence", "medication", "audit"] as const;
export const employeeRecordTabs = ["overview", "training", "certifications", "policies", "medication", "client-assignments", "access-roles", "history"] as const;

export type PortalTab = (typeof portalTabs)[number];
export type EmployeeRecordTab = (typeof employeeRecordTabs)[number];

export function isPortalTab(value: string | null): value is PortalTab {
  return value !== null && portalTabs.includes(value as PortalTab);
}

export function isEmployeeRecordTab(value: string | null): value is EmployeeRecordTab {
  return value !== null && employeeRecordTabs.includes(value as EmployeeRecordTab);
}

export function portalLocation(href: string, organizationId: string, tab: PortalTab, selection: { employeeId?: string; assignmentId?: string; employeeTab?: EmployeeRecordTab } = {}) {
  const url = new URL(href);
  url.pathname = "/admin/compliance-operations";
  url.searchParams.set("organizationId", organizationId);
  if (tab === "dashboard") url.searchParams.delete("view");
  else url.searchParams.set("view", tab);
  if (tab === "training") {
    if (selection.employeeId) url.searchParams.set("employeeId", selection.employeeId);
    else url.searchParams.delete("employeeId");
    if (selection.assignmentId) url.searchParams.set("assignmentId", selection.assignmentId);
    else url.searchParams.delete("assignmentId");
    url.searchParams.delete("employeeTab");
  } else if (tab === "employees") {
    if (selection.employeeId) url.searchParams.set("employeeId", selection.employeeId);
    else url.searchParams.delete("employeeId");
    if (selection.employeeId && selection.employeeTab && selection.employeeTab !== "overview") url.searchParams.set("employeeTab", selection.employeeTab);
    else url.searchParams.delete("employeeTab");
    url.searchParams.delete("assignmentId");
  } else {
    url.searchParams.delete("employeeId");
    url.searchParams.delete("assignmentId");
    url.searchParams.delete("employeeTab");
  }
  return url;
}

export function portalLocationState(href: string) {
  const url = new URL(href), requested = url.searchParams.get("view");
  return {
    tab: isPortalTab(requested) ? requested : "dashboard" as PortalTab,
    employeeId: url.searchParams.get("employeeId") ?? undefined,
    assignmentId: url.searchParams.get("assignmentId") ?? undefined,
    employeeTab: isEmployeeRecordTab(url.searchParams.get("employeeTab")) ? url.searchParams.get("employeeTab") as EmployeeRecordTab : "overview" as EmployeeRecordTab,
  };
}
