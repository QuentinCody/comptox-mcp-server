#!/usr/bin/env node
// Credential-free live MCP contract test; execute returns only synthetic fixtures unless --live-epa is supplied.
import assert from "node:assert/strict";

const endpoint = process.argv.find(value => value.startsWith("http")) || "http://127.0.0.1:8909/mcp";
const protocol = "2026-07-28";
let id = 0;
async function rpc(method, params = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-method": method, "mcp-protocol-version": protocol };
  if (params.name) headers["mcp-name"] = params.name;
  if (params.uri) headers["mcp-name"] = params.uri;
  const response = await fetch(endpoint, { method: "POST", headers, signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": protocol,
      "io.modelcontextprotocol/clientInfo": { name: "comptox-regression", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } } }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 500));
  const envelope = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).find(item => item.id === id)
    : JSON.parse(text);
  assert.ok(!envelope.error, JSON.stringify(envelope.error));
  return envelope.result;
}
async function tool(name, args, success = true) {
  const result = await rpc("tools/call", { name, arguments: args });
  assert.ok(result.content?.length, `${name}: missing content`);
  assert.equal(result.structuredContent?.success, success, JSON.stringify(result.structuredContent));
  assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent)) < 100000);
  assert.match(result.structuredContent._meta.citation.result_hash, /^[a-f0-9]{64}$/);
  if (!success) assert.equal(result.isError, true);
  return result.structuredContent;
}

const listed = await rpc("tools/list");
assert.deepEqual(listed.tools.map(item => item.name).sort(), ["search", "execute", "query_data", "get_schema"]
  .flatMap(suffix => [`comptox_${suffix}`, `mcp_comptox_${suffix}`]).sort());
for (const query of ["toxcast", "chemical identity", "genetic toxicity"]) await tool("comptox_search", { query });
const synthetic = await tool("mcp_comptox_execute", { code: "return {fixture: true, rows:[{aeid:3032, hitc:0, flags:null}]};" });
assert.equal(synthetic.data.fixture, true);
assert.equal(synthetic.data.rows[0].hitc, 0);
await tool("comptox_execute", { code: "return await api.get('https://other.example');" }, false);
const staged = await tool("comptox_execute", { code: "return {fixture:true,rows:Array.from({length:600},(_,id)=>({id,notes:'synthetic '.repeat(20)}))};" });
assert.ok(staged._staging?.data_access_id);
assert.ok(!staged.data?.rows);
const schema = await tool("comptox_get_schema", { data_access_id: staged._staging.data_access_id });
assert.ok(schema.data);
const table = staged._staging.primary_table;
assert.match(table, /^[A-Za-z_][A-Za-z0-9_]*$/);
const count = await tool("comptox_query_data", { data_access_id: staged._staging.data_access_id, sql: `SELECT COUNT(*) AS n FROM "${table}"` });
assert.ok(JSON.stringify(count.data).includes("600"), `All 600 synthetic rows must survive staging: ${JSON.stringify(count.data)}`);
await tool("comptox_query_data", { data_access_id: staged._staging.data_access_id, sql: `DELETE FROM "${table}"` }, false);
const resources = await rpc("resources/list");
assert.equal(resources.resources.length, 4);
const auth = await rpc("resources/read", { uri: "resource://comptox/authentication" });
assert.match(auth.contents[0].text, /CTX_API_KEY/);
if (process.argv.includes("--no-key")) {
  const missing = await tool("comptox_execute", { code: "return await api.get('/chemical/detail/search/by-dtxsid/DTXSID7020182');" }, false);
  assert.match(JSON.stringify(missing), /CTX_API_KEY|CREDENTIAL_REQUIRED/);
}
if (process.argv.includes("--live-epa")) {
  const live = await tool("comptox_execute", { code: "return await api.get('/chemical/detail/search/by-dtxsid/DTXSID7020182');" });
  assert.equal(live.data.rows[0].dtxsid, "DTXSID7020182");
}
console.log("PASS: dual tools, cited success/errors, synthetic staging/schema/SQL, read-only guard, resources. EPA live access only tested with --live-epa.");
