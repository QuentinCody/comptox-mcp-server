import type { ApiCatalog, ApiEndpoint, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const paging: ParamDef[] = [
  { name: "limit", type: "number", required: false, default: 100, description: "Local row window, 1–500. No upstream pagination; the native response is read with a 2 MiB cap." },
  { name: "offset", type: "number", required: false, default: 0, description: "Local offset, 0–10000. Compare provenance.response_sha256 between windows to detect changes." },
];

function endpoint(path: string, category: string, summary: string, exampleId: string, idName = "dtxsid"): ApiEndpoint {
  return { method: "GET", path, category, summary, pathParams: [
    { name: idName, type: idName === "aeid" ? "number" : "string", required: true, description: `Exact EPA ${idName}; e.g. ${exampleId}` },
  ], queryParams: paging, responseShape: "{rows: object[], record_type: string, pagination: {offset, limit, returned, total_filtered, native_records, next_offset, mode}, provenance: {source_url, response_sha256, retrieved_at, dataset_version: null}, interpretation: string}",
    example: `return await api.get('${path.replace(`{${idName}}`, exampleId)}', {limit: 20});` };
}

export const comptoxCatalog: ApiCatalog = {
  name: "EPA CompTox CTX", baseUrl: "https://comptox.epa.gov/ctx-api", version: "catalog observed 2026-10-23; live data unpinned",
  auth: "Individual EPA API key in Worker secret CTX_API_KEY; sent only as x-api-key header. Do not put credentials in code or arguments.",
  notes: "Read-only documented subset: chemical identity by DTXSID/DTXCID, ToxCast bioactivity/assay annotation, ToxValDB/genetic toxicity. Native flags, units, concentrations and missing fields are preserved. No clinical-safety score is computed. Default host is the current official USEPA source base; deployment may select the hardcoded legacy api-ccte.epa.gov host. Authenticated endpoints are not live-verified yet. Local pagination does not reduce upstream download; 2 MiB and 15 second limits fail explicitly. Search discovery and resources work without a key. Do not query test-compound outcomes from these endpoints during protected model evaluation.",
  endpoints: [
    endpoint("/chemical/detail/search/by-dtxsid/{dtxsid}", "chemical.identity", "Get DSSTox substance identity, structure and chemical details", "DTXSID7020182"),
    endpoint("/chemical/detail/search/by-dtxcid/{dtxcid}", "chemical.identity", "Get DSSTox compound identity and chemical details", "DTXCID30182", "dtxcid"),
    endpoint("/bioactivity/data/summary/search/by-dtxsid/{dtxsid}", "bioactivity.summary", "Get native ToxCast bioactivity summary for a substance", "DTXSID7020182"),
    { ...endpoint("/bioactivity/data/search/by-dtxsid/{dtxsid}", "bioactivity.data", "Get ToxCast multiple-concentration assay records with native hit calls, potency and quality flags", "DTXSID7020182"),
      queryParams: [...paging, { name: "aeid", type: "number", required: false, description: "Local exact AEID filter applied after bounded response retrieval. Preserves native records without interpreting hit calls." }] },
    endpoint("/bioactivity/assay/search/by-aeid/{aeid}", "bioactivity.assays", "Get ToxCast assay endpoint annotation, platform and biological interpretation", "3032", "aeid"),
    endpoint("/hazard/toxval/search/by-dtxsid/{dtxsid}", "hazard.toxval", "Get ToxValDB study-level hazard evidence; preserve species, units and sources", "DTXSID7020182"),
    endpoint("/hazard/genetox/summary/search/by-dtxsid/{dtxsid}", "hazard.genetox", "Get native genetic toxicity summary", "DTXSID7020182"),
    endpoint("/hazard/genetox/details/search/by-dtxsid/{dtxsid}", "hazard.genetox", "Get genetic toxicity experimental details", "DTXSID7020182"),
  ],
};
