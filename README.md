# EPA CompTox / CTX MCP server

Read-only, catalog-backed REST integration for DSSTox chemical identity, ToxCast bioactivity and assay annotation, and ToxValDB/genetic toxicity evidence. It uses the current shared stateless Worker and Code Mode factories. No hand-built scientific tools, compute jobs, cloud deployment, or bulk database download is required.

## Tools and resources

The four tools are `comptox_search`, `comptox_execute`, `comptox_query_data`, and `comptox_get_schema`, each also registered with an `mcp_` prefix. All return `content` and `structuredContent`; errors set `isError: true`. Responses carry citations and hashes. Responses above 30 KiB stage through the shared SQLite DO and expose canonical `_staging` metadata; full data is omitted from the compact response.

The DO unwraps transport envelopes before selecting SQL rows. Provider results use `chemical_records`, `assay_records` or `hazard_records`; composed generic results use `rows`. The original envelope remains preserved by shared staging for citation verification. The synthetic regression asserts all 600 rows survive, rather than counting the transport's single `content` item.

Resources: `resource://comptox/catalog`, `query-notes`, `pagination-rate-limits`, and `authentication`.

```javascript
return await api.get('/chemical/detail/search/by-dtxsid/DTXSID7020182');
```

```javascript
return await api.get('/bioactivity/data/search/by-dtxsid/DTXSID7020182', {aeid: 3032, limit: 20});
```

```javascript
return await api.get('/hazard/genetox/details/search/by-dtxsid/DTXSID7020182', {limit: 20});
```

## Authentication and bounds

EPA requires a free individual key, configured as the Worker secret `CTX_API_KEY`. The adapter sends it only in the `x-api-key` header. Discovery/resources work without it, and execution fails explicitly when it is missing. Never send a key through MCP arguments or put one in this repository. [EPA access instructions](https://www.epa.gov/comptox-tools/computational-toxicology-and-exposure-apis-about).

The default is `https://comptox.epa.gov/ctx-api`, matching current official USEPA source configuration. `CTX_API_HOST=legacy` selects the hardcoded historical `https://api-ccte.epa.gov` origin. No arbitrary base URL, redirect forwarding, host fallback, automatic retry, or caller-supplied header is supported. Production API authentication remains **live-unverified**: no key was available or requested during implementation. Public documentation and official source interfaces were inspected on 2026-10-23; direct EPA documentation fetches timed out in this environment.

Each request has a 15 second deadline including body reading and a 2 MiB response cap. The adapter allows at most two simultaneous requests and twenty calls per execution. No background queue is created. `limit` defaults to 100 (maximum 500); `offset` is at most 10,000. These are **local windows over one bounded native response**, not EPA pagination parameters. The optional bioactivity `aeid` filter is also local. Every window reports native and filtered row counts, next offset, and completeness. Repeated windows refetch EPA; compare `provenance.response_sha256` to detect drift. The byte cap fails explicitly without returning a partial result.

## Scientific interpretation

Native assay flags, missing values, concentrations, units, study/species metadata and unknown fields are retained. No hit-call threshold, potency-unit conversion, causal toxicity conclusion or clinical safety score is applied. A response may contain cell-based signals, assay interference or cytotoxic effects rather than direct target binding. Missing evidence does not establish safety. DTXSID substances and DTXCID structures are distinct. Data versions are not inferred: `dataset_version` is null unless the upstream native records themselves supply version fields, which remain intact. Retrieval timestamps and response hashes identify observations, not immutable releases.

Keep this evidence-retrieval track outside protected benchmark predictions: querying CTX outcomes for test compounds would contaminate a binding or toxicity prediction evaluation.

## Source evidence and maintenance

Eight exact GET routes are allowlisted. Evidence for their paths and default projections is in EPA's maintained source interfaces:

- [ChemicalDetailApi.java](https://github.com/USEPA/ccte-api-chemical/blob/6d957c7941b3167f2c760396e899b634ec5ab46e/src/main/java/gov/epa/ccte/api/chemical/web/rest/ChemicalDetailApi.java): `/chemical/detail/search/by-dtxsid/{dtxsid}`, `/chemical/detail/search/by-dtxcid/{dtxcid}`.
- [DataApi.java](https://github.com/USEPA/ccte-api-bioactivity/blob/9bcaa3b9720d056f62fc616a1a9f98b98380f678/src/main/java/gov/epa/ccte/api/bioactivity/web/rest/DataApi.java): `/bioactivity/data/search/by-dtxsid/{dtxsid}` and `/bioactivity/data/summary/search/by-dtxsid/{dtxsid}`.
- [AssayApi.java](https://github.com/USEPA/ccte-api-bioactivity/blob/9bcaa3b9720d056f62fc616a1a9f98b98380f678/src/main/java/gov/epa/ccte/api/bioactivity/web/rest/AssayApi.java): `/bioactivity/assay/search/by-aeid/{aeid}`.
- [ToxValDbApi.java](https://github.com/USEPA/ccte-api-hazard/blob/41ea8ab249d24d2b183c79906f7ecf8895de3de2/src/main/java/gov/epa/ccte/api/hazard/web/rest/ToxValDbApi.java) and [GenetoxApi.java](https://github.com/USEPA/ccte-api-hazard/blob/41ea8ab249d24d2b183c79906f7ecf8895de3de2/src/main/java/gov/epa/ccte/api/hazard/web/rest/GenetoxApi.java): ToxValDB and genetic toxicity summary/details by DTXSID.
- [EPA application configuration](https://github.com/USEPA/ccte-api-bioactivity/blob/9bcaa3b9720d056f62fc616a1a9f98b98380f678/src/main/resources/config/application.yml) verifies the current API base and `x-api-key` header. [EPA data-domain documentation](https://www.epa.gov/comptox-tools/computational-toxicology-and-exposure-apis-data-domains) describes sources. [Historical EPA material](https://www.epa.gov/system/files/documents/2024-06/seem-case-study-pt-1-ber_508.pdf) documents the legacy origin.

Drift risk is high; review these source interfaces and production docs monthly. This is a deliberately small catalog, not full CTX coverage. Chemical name search, exposure, batch POST, projections, all-assay downloads and AED models are outside this initial scope. Expand only after verifying their deployed contracts and limits. A reachable versioned production OpenAPI artifact would justify a hybrid catalog.

## Validation commands

Run serially with the task's resource admission checks; no dependency installation is needed when using the repository's existing toolchain.

The local development runtime is pinned to Wrangler 4.115.0. On this arm64 Mac,
Wrangler 4.69.0 / workerd 1.20260305.0 reproducibly crashed inside the native
runtime during the 600-row staging regression. The same source and fixture pass
with the already-installed Wrangler 4.115.0 / workerd 1.20260722.1. This is a
local runtime compatibility observation, not evidence of authenticated EPA access.

```bash
pnpm exec vitest run servers/comptox-mcp-server/src/lib/api-adapter.test.ts servers/comptox-mcp-server/src/lib/tool-result.test.ts servers/comptox-mcp-server/src/do.test.ts --maxWorkers=1
pnpm --filter comptox-mcp-server run type-check
node servers/comptox-mcp-server/test/structured-content-regression.mjs http://127.0.0.1:8909/mcp --no-key
node scripts/verify-server.mjs comptox --local
```

The regression script tests synthetic staging independently of EPA access. Use `--live-epa` only when an authorized key is configured; that option makes one chemical identity query. Adapter tests use synthetic fixtures and check exact routes, header-only authentication, redirect rejection, redaction, bounds, local completeness and native flag preservation. Tool result tests verify citation hashes and staged evidence. Authenticated multi-domain queries still require separate live validation before production rollout. `/health` is process liveness and `/readyz` tests MCP construction; neither asserts EPA authorization or upstream availability.
