import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createGetSchemaHandler, createQueryDataHandler } from "@bio-mcp/shared/staging/utils";
import { z } from "zod";
import { createComptoxApiFetch } from "../lib/api-adapter";
import { comptoxCatalog } from "../spec/catalog";
import { addStagingMetadata } from "../lib/staging-envelope";
import { comptoxResponse, COMPTOX_SOURCE, type ComptoxResult } from "../lib/tool-result";
import type { CtxConfig } from "../lib/http";

export interface ComptoxEnv extends CtxConfig {
  COMPTOX_DATA_DO: DurableObjectNamespace;
  CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: ComptoxEnv): void {
  const registrar = { tool: (name: unknown, ...args: unknown[]) => {
    const handler = args[args.length - 1] as (...input: unknown[]) => Promise<ComptoxResult>;
    args[args.length - 1] = (...input: unknown[]) => comptoxResponse(
      async () => addStagingMetadata(await handler(...input)), env, String(name), input[1], input[0]);
    for (const alias of [String(name), `mcp_${String(name)}`]) {
      (server.tool.bind(server) as (...values: unknown[]) => void)(alias, ...args);
    }
  } };
  createSearchTool({ prefix: "comptox", catalog: comptoxCatalog }).register(registrar);
  createExecuteTool({ prefix: "comptox", catalog: comptoxCatalog, apiFetch: createComptoxApiFetch(env),
    source: COMPTOX_SOURCE, preserveApiErrors: true, maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024,
    timeout: 60_000, doNamespace: env.COMPTOX_DATA_DO, loader: env.CODE_MODE_LOADER }).register(registrar);
  const query = createQueryDataHandler("COMPTOX_DATA_DO", "comptox");
  const schema = createGetSchemaHandler("COMPTOX_DATA_DO", "comptox");
  registrar.tool("comptox_query_data", "Query staged CompTox evidence using read-only SQL", {
    data_access_id: z.string().min(1), sql: z.string().min(1), limit: z.number().int().min(1).max(10000).optional(),
  }, (args: Record<string, unknown>) => query(args, { ...env }));
  registrar.tool("comptox_get_schema", "Inspect staged CompTox evidence tables", {
    data_access_id: z.string().min(1).optional(),
  }, (args: Record<string, unknown>, extra: Record<string, unknown>) => schema(args, { ...env }, extra));
}
