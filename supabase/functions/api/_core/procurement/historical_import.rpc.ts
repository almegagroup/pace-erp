/* Shared plumbing for the historical import RPCs (erp_history only, never live data). */

type JsonRecord = Record<string, unknown>;

// sha256 of the canonical request body; the RPC uses it for idempotent replay.
export async function requestChecksum(body: JsonRecord): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The RPCs raise "HISTORY_IMPORT_INVALID: ..." / "HISTORY_IMPORT_BATCH_SIZE: ...".
// Anything else is an unexpected database failure.
export function mapHistoryRpcError(message: string | undefined | null): { code: string; status: number; message: string } {
  const raw = String(message ?? "");
  const match = raw.match(/(HISTORY_IMPORT_[A-Z_]+):\s*(.*)$/s);
  if (match) return { code: match[1], status: 400, message: match[2].trim() || match[1] };
  return { code: "HISTORY_IMPORT_FAILED", status: 500, message: "Could not process the historical import." };
}
