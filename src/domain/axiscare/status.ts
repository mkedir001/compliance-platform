export type AxisCareConnectionDisplay = {
  label: string;
  title: string;
  detail: string;
  tone: "neutral" | "warning" | "good" | "danger";
};

const displays: Record<string, AxisCareConnectionDisplay> = {
  NOT_CONFIGURED: {
    label: "Not configured",
    title: "AxisCare is not configured.",
    detail: "Save the AxisCare site and API token before testing the connection.",
    tone: "neutral",
  },
  CONFIGURATION_INCOMPLETE: {
    label: "Saved, not verified",
    title: "AxisCare configuration is saved but unverified.",
    detail: "Test the connection before starting a read-only synchronization.",
    tone: "warning",
  },
  CONNECTED: {
    label: "Connected and verified",
    title: "AxisCare is connected and verified.",
    detail: "Read-only synchronization is available. Billing actions remain disabled.",
    tone: "good",
  },
  AUTHENTICATION_FAILED: {
    label: "Authentication failed",
    title: "AxisCare authentication failed.",
    detail: "Confirm the site and replace the API token, then test again.",
    tone: "danger",
  },
  CONNECTION_UNAVAILABLE: {
    label: "Connection unavailable",
    title: "AxisCare could not be reached.",
    detail: "The saved configuration remains in place. Wait and test the connection again.",
    tone: "warning",
  },
};

export function axisCareConnectionDisplay(status: string): AxisCareConnectionDisplay {
  return displays[status] ?? displays.CONNECTION_UNAVAILABLE;
}
