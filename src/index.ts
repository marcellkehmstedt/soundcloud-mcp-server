import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createAuthRouter } from "./auth/mcpAuth.js";
import { registerTrackTools } from "./tools/tracks.js";
import { registerPlaylistTools } from "./tools/playlists.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();

// Health check — no auth, no body parsing required
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// OAuth endpoints — router applies its own body parsing
app.use("/", createAuthRouter(PUBLIC_URL));

// Active MCP sessions: sessionId → transport
const transports = new Map<string, SSEServerTransport>();

function mcpAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Unauthorized", error_description: "Bearer token required." });
    return;
  }
  req.soundcloudToken = token;
  next();
}

// SSE connection — each connection gets its own McpServer with token in closure
app.get("/mcp/sse", mcpAuthMiddleware, async (req, res) => {
  const token = req.soundcloudToken!;

  const server = new McpServer({
    name: "soundcloud-mcp-server",
    version: "1.0.0",
  });
  registerTrackTools(server, token);
  registerPlaylistTools(server, token);

  const transport = new SSEServerTransport(`${PUBLIC_URL}/mcp/message`, res);
  transports.set(transport.sessionId, transport);

  req.on("close", () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// MCP message endpoint — body intentionally NOT pre-parsed; transport reads stream
app.post("/mcp/message", async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter." });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found or expired." });
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`SoundCloud MCP Server listening on port ${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
  console.log(`MCP SSE endpoint: ${PUBLIC_URL}/mcp/sse`);
  console.log(`OAuth discovery: ${PUBLIC_URL}/.well-known/oauth-authorization-server`);
});
