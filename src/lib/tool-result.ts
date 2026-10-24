import { buildCitation } from "@bio-mcp/shared";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { CtxError } from "./http";

export type ComptoxResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
type DataEnv = { COMPTOX_DATA_DO?: unknown };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const COMPTOX_SOURCE = { id: "comptox", name: "US EPA Computational Toxicology and Exposure APIs", url: "https://comptox.epa.gov/ctx-api/docs/", license: "EPA open data; preserve original study attribution and source-specific terms" };

async function cite(structured: Record<string, unknown>, tool: string, query: unknown) {
  const meta = record(structured._meta) ? structured._meta : {};
  if (record(meta.citation)) return structured;
  const { _meta: _unused, ...root } = structured;
  const citation = await buildCitation({ source: COMPTOX_SOURCE, server: "comptox", tool: tool.replace(/^mcp_/, ""),
    query, queryScope: "tool_arguments", result: root, resultScope: "structured_content:root_without_meta", retrievedAt: new Date().toISOString() });
  return { ...structured, _meta: { ...meta, citation } };
}

/** Contract wrapper covers every alias, including credential failures and composed oversized output. */
export async function comptoxResponse(work: () => Promise<ComptoxResult>, env: DataEnv, tool: string, extra: unknown, query: unknown = {}): Promise<ComptoxResult> {
  try {
    const original = await work().catch((error: unknown) => {
      const safe = error instanceof CtxError ? { code: error.code, message: error.message, status: error.status }
        : { code: "RESPONSE_ERROR", message: "CompTox response could not be returned." };
      return { content: [{ type: "text" as const, text: safe.message }], structuredContent: { success: false, error: safe }, isError: true };
    });
    const structured: Record<string, unknown> = original.structuredContent ?? { success: original.isError !== true };
    const failed = original.isError === true || structured.success === false || (record(structured.data) && structured.data.__api_error === true)
      || Boolean(structured.program_error) || structured.disposition === "partial";
    const result = { ...original, structuredContent: await cite({ ...structured, success: !failed }, tool, query), ...(failed ? { isError: true } : {}) };
    if (!shouldStage(bytes(result) + 1024)) return result;
    if (!env.COMPTOX_DATA_DO) throw new Error("Missing staging storage");
    const staged = await stageToDoAndRespond(result, env.COMPTOX_DATA_DO as Parameters<typeof stageToDoAndRespond>[1], "comptox", undefined,
      { toolName: tool, serverName: "comptox" }, "comptox", extra as Parameters<typeof stageToDoAndRespond>[6]);
    const citation = await buildCitation({ source: COMPTOX_SOURCE, server: "comptox", tool: tool.replace(/^mcp_/, ""), query,
      queryScope: "tool_arguments", result, resultScope: "staged:full_result", dataAccessId: staged.dataAccessId, retrievedAt: new Date().toISOString() });
    const structuredContent = { success: !failed, staged: true, data: undefined, data_access_id: staged.dataAccessId,
      _staging: staged._staging, _meta: { citation } };
    if (bytes(structuredContent) > 100000) throw new Error("Staging metadata exceeds transport limit");
    const response: ComptoxResult = { content: [{ type: "text", text: "Response staged. Use comptox_get_schema and comptox_query_data with _staging.data_access_id." }], structuredContent, ...(failed ? { isError: true } : {}) };
    if (shouldStage(bytes(response) + 1024)) throw new Error("Staging metadata exceeds inline limit");
    return response;
  } catch {
    const message = "CompTox response could not be returned within transport limits.";
    const structuredContent = await cite({ success: false, error: { code: "RESPONSE_ERROR", message } }, tool, query);
    return { content: [{ type: "text", text: message }], structuredContent, isError: true };
  }
}
