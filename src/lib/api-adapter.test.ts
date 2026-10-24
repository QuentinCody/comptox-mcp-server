import { afterEach, expect, it, vi } from "vitest";
import { createComptoxApiFetch } from "./api-adapter";
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, type CtxConfig } from "./http";

const path = "/bioactivity/data/search/by-dtxsid/DTXSID7020182";
const config = { CTX_API_KEY: "fixture-credential-not-real" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("requires a configured key before issuing any request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createComptoxApiFetch()({ method: "GET", path })).rejects.toMatchObject({ code: "CREDENTIAL_REQUIRED", status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps the credential in the header and preserves assay quality flags, nulls and future fields", async () => {
  const native = [{ aeid: 3032, dtxsid: "DTXSID7020182", hitc: 0.7, ac50: null, mc6Param: { flag: [1, 6] }, future: { value: 0 } }];
  const fetcher = vi.fn().mockResolvedValue(Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await createComptoxApiFetch(config)({ method: "GET", path });
  expect(result).toMatchObject({ status: 200, completeness: { complete: true, returned: 1 }, data: { rows: native,
    provenance: { source_url: "https://comptox.epa.gov/ctx-api" + path, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), dataset_version: null } } });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://comptox.epa.gov/ctx-api" + path);
  expect(options).toMatchObject({ method: "GET", redirect: "manual", headers: { Accept: "application/json", "x-api-key": config.CTX_API_KEY } });
  expect(JSON.stringify(result)).not.toContain(config.CTX_API_KEY);
});

it("uses only the explicit legacy host choice", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetcher);
  await createComptoxApiFetch({ ...config, CTX_API_HOST: "legacy" })({ method: "GET", path });
  expect(fetcher.mock.calls[0][0]).toBe("https://api-ccte.epa.gov" + path);
  await expect(createComptoxApiFetch({ ...config, CTX_API_HOST: "toString" } as unknown as CtxConfig)({ method: "GET", path })).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("applies bounded local windows and AEID filters without sending fake pagination to EPA", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json([{ aeid: 1 }, { aeid: 2 }, { aeid: 2, flag: null }])); vi.stubGlobal("fetch", fetcher);
  const api = createComptoxApiFetch(config);
  const first = await api({ method: "GET", path, params: { aeid: 2, limit: 1 } });
  expect(first).toMatchObject({ completeness: { complete: false, total_available: 2, returned: 1, truncation: { reason: "row_limit" } },
    data: { rows: [{ aeid: 2 }], pagination: { native_records: 3, total_filtered: 2, next_offset: 1 } } });
  const second = await api({ method: "GET", path, params: { aeid: 2, offset: 1, limit: 1 } });
  expect(second).toMatchObject({ completeness: { complete: false }, data: { rows: [{ aeid: 2, flag: null }], pagination: { next_offset: null } } });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["https://comptox.epa.gov/ctx-api" + path, "https://comptox.epa.gov/ctx-api" + path]);
});

it.each([
  ["/chemical/detail/search/by-dtxsid/DTXSID7020182", { dtxsid: "DTXSID7020182", smiles: "C" }, "chemical"],
  ["/chemical/detail/search/by-dtxcid/DTXCID30182", { dtxcid: "DTXCID30182" }, "chemical"],
  ["/bioactivity/assay/search/by-aeid/3032", [{ aeid: 3032, assayFormatType: "cell-based" }], "assay"],
  ["/hazard/toxval/search/by-dtxsid/DTXSID7020182", [{ toxvalType: "NOAEL", toxvalNumeric: 0, units: "mg/kg/day" }], "hazard"],
  ["/hazard/genetox/summary/search/by-dtxsid/DTXSID7020182", [{ call: "mixed" }], "hazard"],
  ["/hazard/genetox/details/search/by-dtxsid/DTXSID7020182", [{ result: null }], "hazard"],
])("routes %s to the documented exact path", async (route, native, recordType) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await createComptoxApiFetch(config)({ method: "GET", path: route as string });
  expect(fetcher.mock.calls[0][0]).toBe("https://comptox.epa.gov/ctx-api" + route);
  expect(result).toMatchObject({ data: { record_type: recordType, rows: Array.isArray(native) ? native : [native] } });
});

it.each([
  { method: "POST", path }, { method: "GET", path, body: {} },
  { method: "GET", path: "https://other.example/chemical" }, { method: "GET", path: path + "?x-api-key=bad" },
  { method: "GET", path: path + "/../all" }, { method: "GET", path: path.replace("DTXSID7020182", "%44TXSID7020182") },
  { method: "GET", path, params: { limit: 501 } }, { method: "GET", path, params: { offset: -1 } },
  { method: "GET", path, params: { limit: "10" } }, { method: "GET", path, params: { page: 1 } },
  { method: "GET", path: "/hazard/toxval/search/by-dtxsid/DTXSID7020182", params: { aeid: 3032 } },
])("rejects unsupported inputs before network access: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createComptoxApiFetch(config)(request)).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([301, 302, 401, 403, 429, 500])("does not follow or retry HTTP %i, and never echoes an upstream credential", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response(config.CTX_API_KEY, { status, headers: { Location: "https://other.example", "Retry-After": "60" } })); vi.stubGlobal("fetch", fetcher);
  await expect(createComptoxApiFetch(config)({ method: "GET", path })).rejects.toMatchObject({ status,
    code: status === 401 || status === 403 ? "CREDENTIAL_REJECTED" : "UPSTREAM_HTTP_ERROR" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects credential reflection, invalid JSON and unexpected schemas instead of fabricating empty evidence", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ reflected: config.CTX_API_KEY }))
    .mockResolvedValueOnce(new Response("not json"))
    .mockResolvedValueOnce(Response.json({ unexpected: true }))
    .mockResolvedValueOnce(Response.json([{ missing_aeid: true }]));
  vi.stubGlobal("fetch", fetcher);
  const api = createComptoxApiFetch(config);
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "CREDENTIAL_REFLECTION" });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "INVALID_JSON" });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "UNEXPECTED_SCHEMA" });
  await expect(api({ method: "GET", path, params: { aeid: 3032 } })).rejects.toMatchObject({ code: "UNEXPECTED_SCHEMA" });
});

it("enforces both declared and streamed response byte limits", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("[]", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }))
    .mockResolvedValueOnce(new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1)));
  vi.stubGlobal("fetch", fetcher);
  const api = createComptoxApiFetch(config);
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
});

it("aborts a delayed request at the deadline and redacts transport error details", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error(config.CTX_API_KEY)));
  })));
  const pending = createComptoxApiFetch(config)({ method: "GET", path });
  const assertion = expect(pending).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", message: "EPA CTX exceeded the 15 second request deadline." });
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await assertion;
});

it("bounds concurrent requests without queuing an unbounded batch", async () => {
  const finish: Array<(value: Response) => void> = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => finish.push(resolve))); vi.stubGlobal("fetch", fetcher);
  const api = createComptoxApiFetch(config);
  const one = api({ method: "GET", path }); const two = api({ method: "GET", path });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "REQUEST_BUDGET", status: 429 });
  finish.forEach(resolve => resolve(Response.json([])));
  await Promise.all([one, two]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("limits sequential execution to twenty upstream calls", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json([])); vi.stubGlobal("fetch", fetcher);
  const api = createComptoxApiFetch(config);
  for (let index = 0; index < 20; index++) await api({ method: "GET", path });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ code: "REQUEST_BUDGET", status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(20);
});
