import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { CtxError, fetchCtx, type CtxConfig } from "./http";

const DTXSID = "DTXSID[0-9]{3,12}";
const DTXCID = "DTXCID[0-9]{1,12}";
const routes = [
  { expression: new RegExp(`^/chemical/detail/search/by-dtxsid/${DTXSID}$`), kind: "chemical" },
  { expression: new RegExp(`^/chemical/detail/search/by-dtxcid/${DTXCID}$`), kind: "chemical" },
  { expression: new RegExp(`^/bioactivity/data/(?:summary/)?search/by-dtxsid/${DTXSID}$`), kind: "bioactivity" },
  { expression: /^\/bioactivity\/assay\/search\/by-aeid\/[1-9][0-9]{0,8}$/, kind: "assay" },
  { expression: new RegExp(`^/hazard/(?:toxval|genetox/(?:summary|details))/search/by-dtxsid/${DTXSID}$`), kind: "hazard" },
] as const;

function boundedInteger(value: unknown, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CtxError("INVALID_PARAMETER", `${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

/** Exact read-only routes. limit/offset/aeid are LOCAL filters, never invented upstream parameters. */
export function createComptoxApiFetch(config: CtxConfig = {}): ApiFetchFn {
  let inFlight = 0;
  let calls = 0;
  return async request => {
    if (request.method !== "GET" || request.body !== undefined) throw new CtxError("READ_ONLY", "CompTox supports only the documented GET routes.");
    const route = routes.find(candidate => candidate.expression.test(request.path));
    if (!route) throw new CtxError("UNSUPPORTED_ROUTE", "Unsupported CompTox path. Discover exact routes with comptox_search.");
    const params = request.params ?? {};
    if (Object.keys(params).some(key => !["limit", "offset", "aeid"].includes(key))) throw new CtxError("INVALID_PARAMETER", "Only local limit, offset, and bioactivity aeid filters are supported.");
    const limit = boundedInteger(params.limit, "limit", 100, 1, 500);
    const offset = boundedInteger(params.offset, "offset", 0, 0, 10000);
    if (params.aeid !== undefined && !/^\/bioactivity\/data\/search\//.test(request.path)) throw new CtxError("INVALID_PARAMETER", "aeid filtering is only supported for bioactivity data by DTXSID.");
    const aeid = params.aeid === undefined ? undefined : boundedInteger(params.aeid, "aeid", 0, 1, 999999999);
    if (inFlight >= 2 || calls >= 20) throw new CtxError("REQUEST_BUDGET", "CompTox permits two concurrent requests and twenty requests per execution; reduce the batch.", 429);
    inFlight++; calls++;
    try {
      const { native, ...provenance } = await fetchCtx(request.path, config);
      const records = Array.isArray(native) ? native : route.kind === "chemical" && native && typeof native === "object" ? [native] : undefined;
      if (!records || records.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new CtxError("UNEXPECTED_SCHEMA", "EPA returned an unexpected record shape; no empty result was inferred.", 502);
      if (aeid !== undefined && records.some(row => !Number.isSafeInteger(Number(row.aeid)) || Number(row.aeid) < 1)) throw new CtxError("UNEXPECTED_SCHEMA", "Bioactivity records have missing or invalid AEIDs; the filter was not applied.", 502);
      const filtered = aeid === undefined ? records : records.filter(row => String(row.aeid) === String(aeid));
      const rows = filtered.slice(offset, offset + limit);
      const complete = offset === 0 && rows.length === filtered.length;
      const completeness = { complete, total_available: filtered.length, returned: rows.length,
        ...(!complete ? { truncation: { reason: "row_limit" as const, detail: "Local window over the bounded native response; upstream pagination is not supported.", remedy: "Request consecutive offset windows; freeze response_sha256 to detect upstream drift." } } : {}) };
      return { status: 200, completeness, upstreamTotal: filtered.length, data: {
        rows, record_type: route.kind, pagination: { offset, limit, returned: rows.length, total_filtered: filtered.length,
          native_records: records.length, next_offset: offset + rows.length < filtered.length ? offset + rows.length : null,
          mode: "local_window_over_one_native_response" },
        provenance: { ...provenance, api_host: config.CTX_API_HOST ?? "current", dataset_version: null,
          version_note: "Live API, not a pinned release. Retain any native invitrodb, assay, or study version fields." },
        interpretation: "Native assay activity, hazard, and confidence/quality flags are retained. Activity is not evidence of clinical toxicity; an empty result is not evidence of safety.",
      } };
    } finally { inFlight--; }
  };
}
