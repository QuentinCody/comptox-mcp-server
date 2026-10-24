import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { detectArrays, inferSchema, materializeSchema } from "@bio-mcp/shared/staging/schema-inference";
vi.mock("@bio-mcp/shared/staging/rest-staging-do", () => ({ RestStagingDO: class {} }));
import { ComptoxDataDO } from "./do";

const project = (value: unknown) => (ComptoxDataDO.prototype as unknown as { getTabularData: (data: unknown) => unknown }).getTabularData(value);

it("materializes all 600 scientific rows instead of the transport content array", () => {
  const rows = Array.from({ length: 600 }, (_, id) => ({ id, notes: "synthetic ".repeat(20) }));
  const envelope = { content: [{ type: "text", text: "Scientific result" }], structuredContent: { success: true, data: { fixture: true, rows } } };
  const preserved = JSON.stringify(envelope);
  const arrays = detectArrays(project(envelope));
  const schema = inferSchema(arrays);
  const database = new DatabaseSync(":memory:");
  try {
    const result = materializeSchema(schema, new Map(arrays.map(array => [array.key, array.rows])), {
      exec: (query, ...bindings) => database.prepare(query).run(...bindings as SQLInputValue[]),
    });
    expect(result.failedRows).toBe(0);
    expect(result.tablesCreated).toEqual(["rows"]);
    expect(database.prepare("SELECT COUNT(*) AS n, MIN(id) AS first, MAX(id) AS last FROM rows").get()).toEqual({ n: 600, first: 0, last: 599 });
    expect(JSON.stringify(envelope)).toBe(preserved);
  } finally { database.close(); }
});

it("projects provider records into domain tables while retaining native row objects", () => {
  const rows = [{ aeid: 3032, hitc: 0, ac50: null, mc6Param: { flag: [1, 6] } }];
  const data = { record_type: "bioactivity", rows, provenance: { response_sha256: "a".repeat(64) } };
  expect(project(data)).toEqual({ assay_records: rows });
  expect((project(data) as { assay_records: unknown[] }).assay_records).toBe(rows);
  expect(project({ record_type: "hazard", rows })).toEqual({ hazard_records: rows });
  expect(project({ record_type: "chemical", rows })).toEqual({ chemical_records: rows });
});

it("keeps derived SQL result rows under a separate projection", () => {
  expect(project({ content: [], structuredContent: { data: { sql: "SELECT 1 AS n", rows: [{ n: 1 }] } } })).toEqual({ query_rows: [{ native: { n: 1 } }] });
});
