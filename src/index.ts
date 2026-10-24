import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { McpServer, StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { registerCodeMode, type ComptoxEnv } from "./tools/code-mode";
import { registerResources } from "./resources";
export { ComptoxDataDO } from "./do";

export class MyMCP extends StatelessMcpWorker {
  server = new McpServer({ name: "comptox", version: "0.1.0" });
  async init() {
    configureCitationSigning(this.env);
    registerCodeMode(this.server, this.env as unknown as ComptoxEnv);
    registerResources(this.server);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return buildHealthResponse("comptox");
    if (url.pathname === "/readyz") return MyMCP.readiness(env, "comptox");
    if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
