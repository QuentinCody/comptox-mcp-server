import { buildStagingMetadata } from "@bio-mcp/shared/staging/staging-metadata";
import type { ComptoxResult } from "./tool-result";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Canonical metadata for legacy shared-executor staging handles; cited data stays untouched. */
export function addStagingMetadata(result: ComptoxResult): ComptoxResult {
  const content = result.structuredContent;
  if (!content || record(content._staging)) return result;
  const data = record(content.data);
  const meta = record(content._meta);
  const stage = data?.__staged ? data : meta?.staged ? meta : undefined;
  if (!stage || typeof stage.data_access_id !== "string" || !Array.isArray(stage.tables_created)) return result;
  const tables = stage.tables_created.filter((value): value is string => typeof value === "string");
  if (!tables.length) return result;
  return { ...result, structuredContent: { ...content, _staging: buildStagingMetadata({ dataAccessId: stage.data_access_id,
    tables, toolPrefix: "comptox", totalRows: typeof stage.total_rows === "number" ? stage.total_rows : undefined,
    payloadHash: typeof meta?.payload_hash === "string" ? meta.payload_hash : undefined }) } };
}
