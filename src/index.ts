import { randomUUID } from "crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuthRouter } from "./auth/mcpAuth.js";
import { registerTrackTools } from "./tools/tracks.js";
import { registerPlaylistTools } from "./tools/playlists.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();

// CORS — Claude Web is a browser app and makes cross-origin requests
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, mcp-session-id"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  next();
});

app.options("*", (_req, res) => res.status(204).end());

// Health check — public, no auth
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
const sessions = new Map<string, StreamableHTTPServerTransport>();

function mcpAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      error_description: "Bearer token required.",
    });
    return;
  }
  req.soundcloudToken = token;
  next();
}

function createMcpServer(token: string): McpServer {
  const server = new McpServer({
    name: "soundcloud-mcp-server",
    version: "1.0.0",
  });
  registerTrackTools(server, token);
  registerPlaylistTools(server, token);
  return server;
}

// Single MCP endpoint using Streamable HTTP transport (MCP spec 2025-03-26)
// Handles GET (SSE stream), POST (messages), and DELETE (session teardown)
app.all("/mcp", express.json(), mcpAuthMiddleware, async (req, res) => {
  const token = req.soundcloudToken!;
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Route to an existing session
  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — must start with POST (initialize)
  if (req.method !== "POST") {
    res.status(400).json({
      error: "New sessions must be initialised with a POST request.",
    });
    return;
  }

  // Pre-generate the session ID so we can store it before handleRequest
  const newSessionId = randomUUID();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
  });

  sessions.set(newSessionId, transport);

  transport.onclose = () => {
    sessions.delete(newSessionId);
  };

  const server = createMcpServer(token);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`SoundCloud MCP Server listening on port ${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
  console.log(`MCP endpoint:      ${PUBLIC_URL}/mcp`);
  console.log(`OAuth discovery:   ${PUBLIC_URL}/.well-known/oauth-authorization-server`);
});
