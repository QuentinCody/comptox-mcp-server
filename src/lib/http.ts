export const CTX_BASES = {
  current: "https://comptox.epa.gov/ctx-api",
  legacy: "https://api-ccte.epa.gov",
} as const;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 15000;

export class CtxError extends Error {
  readonly data: { code: string; message: string };
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.data = { code, message };
  }
}

export interface CtxConfig {
  CTX_API_KEY?: string;
  CTX_API_HOST?: "current" | "legacy";
}

/** No automatic redirects: the credential must never follow a provider redirect. */
export async function fetchCtx(path: string, config: CtxConfig): Promise<{
  native: unknown; source_url: string; response_sha256: string; retrieved_at: string;
}> {
  const key = config.CTX_API_KEY?.trim();
  if (!key) throw new CtxError("CREDENTIAL_REQUIRED", "Configure the Worker secret CTX_API_KEY with an individual EPA CTX API key.", 401);
  if (key.length > 512 || /[\r\n]/.test(key)) throw new CtxError("CREDENTIAL_INVALID", "The configured CTX_API_KEY is invalid.", 401);
  const host = config.CTX_API_HOST ?? "current";
  if (!Object.prototype.hasOwnProperty.call(CTX_BASES, host)) throw new CtxError("CONFIGURATION_ERROR", "CTX_API_HOST must be current or legacy.", 500);
  const url = CTX_BASES[host] + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/json", "x-api-key": key } });
    if (!response.ok) {
      await response.body?.cancel();
      const auth = response.status === 401 || response.status === 403;
      throw new CtxError(auth ? "CREDENTIAL_REJECTED" : "UPSTREAM_HTTP_ERROR",
        auth ? "EPA rejected the configured CTX API credential." : `EPA CTX returned HTTP ${response.status}; no automatic retry was made.`, response.status);
    }
    const bytes = await readBounded(response);
    // The API key must not escape through an accidental upstream reflection, including on success.
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (raw.includes(key)) throw new CtxError("CREDENTIAL_REFLECTION", "EPA response withheld because it reflected the credential.", 502);
    let native: unknown;
    try { native = JSON.parse(raw); } catch { throw new CtxError("INVALID_JSON", "EPA returned invalid JSON.", 502); }
    if (JSON.stringify(native).includes(key)) throw new CtxError("CREDENTIAL_REFLECTION", "EPA response withheld because it reflected the credential.", 502);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const response_sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    return { native, source_url: url, response_sha256, retrieved_at: new Date().toISOString() };
  } catch (error) {
    if (error instanceof CtxError) throw error;
    throw new CtxError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
      controller.signal.aborted ? "EPA CTX exceeded the 15 second request deadline." : "EPA CTX could not be read; no automatic retry was made.", 502);
  } finally { clearTimeout(timer); }
}

async function readBounded(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new CtxError("RESPONSE_TOO_LARGE", "EPA response exceeds the 2 MiB read limit; use a narrower documented query.", 502);
  }
  if (!response.body) throw new CtxError("EMPTY_RESPONSE", "EPA response has no body.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CtxError("RESPONSE_TOO_LARGE", "EPA response exceeds the 2 MiB read limit; no partial result was returned.", 502);
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
