import type { McpServer } from "@bio-mcp/shared/mcp";
import { comptoxCatalog } from "./spec/catalog";

export function registerResources(server: McpServer): void {
  const resources: Record<string, unknown> = {
    catalog: comptoxCatalog,
    "query-notes": { notes: comptoxCatalog.notes, source_docs_observed: "2026-10-23",
      distinction: "DTXSID identifies a substance; DTXCID a structure. Preserve salt, mixture, assay and species distinctions. CTX observations are evidence, not a clinical adverse-event prediction.",
      exclusions: "No batch POST, bulk assay download, arbitrary URL, clinical safety score, or undocumented Kinobeads endpoint." },
    "pagination-rate-limits": { timeout_ms: 15000, max_response_bytes: 2097152, max_in_flight: 2, max_calls_per_execution: 20,
      default_limit: 100, max_limit: 500, max_offset: 10000, upstream_pagination: false,
      note: "Offset and limit slice one bounded native response locally; repeated windows refetch it. Compare response_sha256. No automatic retries; honor upstream throttling. Responses above 30 KiB stage into SQLite." },
    authentication: { secret: "CTX_API_KEY", header: "x-api-key", host_selector: "CTX_API_HOST=current|legacy (default current)",
      source: "https://www.epa.gov/comptox-tools/computational-toxicology-and-exposure-apis-about",
      status: "Individual free EPA key required. Configure as a Worker secret; never pass through MCP arguments. Authenticated routes have not yet been live-verified. Search/resources remain available without a key." },
  };
  for (const [name, value] of Object.entries(resources)) {
    const uri = `resource://comptox/${name}`;
    server.registerResource(name, uri, { mimeType: "application/json", description: `EPA CompTox ${name}` },
      async () => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }] }));
  }
}
