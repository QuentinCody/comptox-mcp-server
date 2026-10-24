import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export class ComptoxDataDO extends RestStagingDO {
  /** Project scientific rows for SQL; shared staging preserves the untouched full envelope separately. */
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (record(data) && Array.isArray(data.rows)) {
      if (typeof data.sql === "string") return { query_rows: data.rows.map(native => ({ native })) };
      const table = data.record_type === "chemical" ? "chemical_records" : data.record_type === "hazard" ? "hazard_records"
        : data.record_type === "assay" || data.record_type === "bioactivity" ? "assay_records" : "rows";
      return { [table]: data.rows };
    }
    if (Array.isArray(data)) return { records: data };
    return data;
  }

  protected getSchemaHints(data: unknown): SchemaHints | undefined {
    const sample = Array.isArray(data) ? data[0] : undefined;
    if (!sample || typeof sample !== "object") return undefined;
    if ("aeid" in sample) return { tableName: "assay_records", indexes: ["aeid"] };
    if ("toxvalType" in sample) return { tableName: "hazard_records", indexes: ["dtxsid"] };
    if ("dtxsid" in sample) return { tableName: "chemical_records", indexes: ["dtxsid"] };
    return undefined;
  }
}
