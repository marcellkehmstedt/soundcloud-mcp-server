import { randomUUID } from "crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAuthRouter } from "./auth/mcpAuth.js";
import { registerTrackTools } from "./tools/tracks.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { dbg, DEBUG } from "./debug.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();

// CORS — Claude Web is a browser app that makes cross-origin requests.
// WWW-Authenticate must be exposed so the browser can read it and discover
// the OAuth metadata URL after receiving a 401 from the /mcp endpoint.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, mcp-session-id, MCP-Protocol-Version"
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, WWW-Authenticate");
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

// Diagnostic endpoint — tests the SoundCloud token that the MCP server would use.
// Requires the same Bearer token Claude sends to /mcp.
// Useful for verifying SoundCloud API connectivity without going through Claude Web.
app.get("/diagnostic", async (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Pass your SoundCloud access token as 'Authorization: Bearer <token>'" });
    return;
  }

  const results: Record<string, unknown> = { token_length: token.length };
  const t0 = Date.now();

  try {
    const r = await fetch("https://api.soundcloud.com/me", {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    results["GET /me"] = { status: r.status, ok: r.ok };
    if (r.ok) results["me"] = await r.json();
    else results["me_error"] = await r.text().catch(() => "");
  } catch (e) {
    results["GET /me"] = { error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const r = await fetch("https://api.soundcloud.com/me/playlists", {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    results["GET /me/playlists"] = { status: r.status, ok: r.ok };
    if (r.ok) {
      const body = await r.json() as unknown;
      // SoundCloud may return { collection: [...] } or a plain array
      results["playlists_preview"] = Array.isArray(body)
        ? `array of ${(body as unknown[]).length}`
        : (body as Record<string, unknown>)?.collection
          ? `collection of ${((body as Record<string, unknown>).collection as unknown[]).length}`
          : body;
    } else {
      results["playlists_error"] = await r.text().catch(() => "");
    }
  } catch (e) {
    results["GET /me/playlists"] = { error: e instanceof Error ? e.message : String(e) };
  }

  results["elapsed_ms"] = Date.now() - t0;
  res.json(results);
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
    // WWW-Authenticate with resource_metadata_url is what Claude Web reads to
    // discover the OAuth authorization server — without this header the browser
    // doesn't know where to start the OAuth flow.
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="${PUBLIC_URL}", resource_metadata_url="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`
    );
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

  // Log every JSON-RPC method call when debug is enabled
  if (DEBUG && req.method === "POST" && req.body?.method) {
    const params = req.body.params ? JSON.stringify(req.body.params).slice(0, 300) : "{}";
    dbg("MCP", `→ ${req.body.method} ${params}`);
  }

  // Route to an existing session
  if (sessionId) {
    dbg("MCP", `session ${sessionId} — ${req.method}`);
    const transport = sessions.get(sessionId);
    if (!transport) {
      dbg("MCP", `session ${sessionId} not found`);
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
  dbg("MCP", `new session ${newSessionId}`);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => newSessionId,
  });

  sessions.set(newSessionId, transport);

  transport.onclose = () => {
    dbg("MCP", `session ${newSessionId} closed`);
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
  if (DEBUG) console.log(`Debug logging:     enabled (MCP_DEBUG=true)`);
});
