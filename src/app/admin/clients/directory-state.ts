export type ClientDirectoryLoadStatus = "idle" | "loading" | "success" | "error";

export type ClientDirectoryView = "loading" | "results" | "empty" | "error";

export function clientDirectoryView(status: ClientDirectoryLoadStatus, clientCount: number): ClientDirectoryView {
  if (status === "error") return "error";
  if (status !== "success") return "loading";
  return clientCount > 0 ? "results" : "empty";
}
