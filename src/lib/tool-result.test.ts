import { expect, it } from "vitest";
import { comptoxResponse } from "./tool-result";
import { CtxError } from "./http";
import { verifyCitationEnvelope } from "../../../../packages/provenance-core/src/index";
import { addStagingMetadata } from "./staging-envelope";

function storage() {
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") stored.push((await request.json() as { data: unknown }).data);
    return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1, input_rows: 1, schema: { tables: {} } });
  } }) };
  return { stored, env: { COMPTOX_DATA_DO: namespace } };
}

it("returns both fields and a verifiable citation for explicit credential errors", async () => {
  const query = { code: "return await api.get('/bioactivity/data/search/by-dtxsid/DTXSID7020182');" };
  const result = await comptoxResponse(async () => { throw new CtxError("CREDENTIAL_REQUIRED", "Configure CTX_API_KEY.", 401); }, {}, "comptox_execute", {}, query);
  expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: "Configure CTX_API_KEY." }], structuredContent: {
    success: false, error: { code: "CREDENTIAL_REQUIRED", status: 401 }, _meta: { citation: { source: { id: "comptox" } } } } });
  const structured = result.structuredContent!;
  const checked = await verifyCitationEnvelope({ citation: (structured._meta as { citation: unknown }).citation, structuredContent: structured, toolArguments: query });
  expect(checked.verification).toMatchObject({ query: "verified", result: "verified" });
});

it("stages the complete large failed envelope, preserves failure, and removes the inline data", async () => {
  const original = { content: [{ type: "text" as const, text: "α😀".repeat(6000) }], structuredContent: { success: false, data: { flag: [1, 6], ac50: null } }, isError: true };
  const { stored, env } = storage(); const query = { code: "fixture" };
  const result = await comptoxResponse(async () => original, env, "mcp_comptox_execute", {}, query);
  expect(result).toMatchObject({ isError: true, structuredContent: { success: false, staged: true, _staging: { data_access_id: expect.any(String) } } });
  expect(result.structuredContent?.data).toBeUndefined();
  const full = stored.find(value => typeof value === "object" && value !== null && "content" in value);
  expect(full).toMatchObject({ content: original.content, structuredContent: { data: original.structuredContent.data } });
  const structured = result.structuredContent!;
  const checked = await verifyCitationEnvelope({ citation: (structured._meta as { citation: unknown }).citation, structuredContent: structured, toolArguments: query, materialized: { value: full } });
  expect(checked.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
});

it("marks preserved API errors as failures and gives a bounded error if staging is unavailable", async () => {
  const apiError = await comptoxResponse(async () => ({ content: [{ type: "text", text: "Error" }], structuredContent: { data: { __api_error: true, status: 401 } } }), {}, "comptox_execute", {});
  expect(apiError).toMatchObject({ isError: true, structuredContent: { success: false } });
  const oversized = await comptoxResponse(async () => ({ content: [{ type: "text", text: "x".repeat(100000) }] }), {}, "comptox_execute", {});
  expect(oversized).toMatchObject({ isError: true, structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } } });
  expect(JSON.stringify(oversized).length).toBeLessThan(30720);
});

it("adds canonical metadata to shared-executor handles without modifying cited data", () => {
  const data = { __staged: true, data_access_id: "fixture", tables_created: ["assays"], total_rows: 500 };
  const result = addStagingMetadata({ content: [], structuredContent: { data } });
  expect(result.structuredContent?.data).toBe(data);
  expect(result.structuredContent?._staging).toMatchObject({ data_access_id: "fixture", tables: ["assays"], total_rows: 500, query_tool: "comptox_query_data", schema_tool: "comptox_get_schema" });
});
