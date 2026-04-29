import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import {
  storePKCEState,
  getPKCEState,
  deletePKCEState,
  storeAuthCodeSession,
  getAuthCodeSession,
  deleteAuthCodeSession,
} from "./pkceStore.js";
import type { RefreshTokenPayload } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGIN_HTML = readFileSync(
  join(__dirname, "..", "..", "src", "ui", "login.html"),
  "utf8"
);

const SC_AUTH_URL = "https://soundcloud.com/connect";
const SC_TOKEN_URL = "https://api.soundcloud.com/oauth2/token";

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return computed === codeChallenge;
}

function encodeRefreshToken(payload: RefreshTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export function createAuthRouter(publicUrl: string): express.Router {
  const router = express.Router();

  router.use(express.urlencoded({ extended: false }));

  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  const authServerMetadata = {
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(authServerMetadata);
  });

  // RFC 9728 — OAuth 2.0 Protected Resource Metadata
  // Claude Web probes /.well-known/oauth-protected-resource{path} to learn
  // which authorization server protects a given resource. Without this,
  // Claude reports "can't reach the MCP server" even when the server is up.
  // For MCP URL https://host/mcp the path-aware probe is /mcp appended.
  const protectedResourceMetadata = {
    resource: `${publicUrl}/mcp`,
    authorization_servers: [publicUrl],
  };

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(protectedResourceMetadata);
  });

  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json(protectedResourceMetadata);
  });

  // GET /oauth/authorize — render login form
  router.get("/oauth/authorize", (req, res) => {
    const { response_type, code_challenge, code_challenge_method, state, redirect_uri, client_id } =
      req.query as Record<string, string>;

    if (
      response_type !== "code" ||
      !code_challenge ||
      !state ||
      !redirect_uri
    ) {
      res.status(400).send("Invalid authorization request.");
      return;
    }

    if (code_challenge_method && code_challenge_method !== "S256") {
      res.status(400).send("Only S256 code_challenge_method is supported.");
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      LOGIN_HTML.replace("{{code_challenge}}", escHtml(code_challenge))
        .replace("{{state}}", escHtml(state))
        .replace("{{redirect_uri}}", escHtml(redirect_uri))
        .replace("{{client_id}}", escHtml(client_id ?? ""))
    );
  });

  // POST /oauth/authorize — process login form, redirect to SoundCloud
  router.post("/oauth/authorize", (req, res) => {
    const {
      sc_client_id,
      sc_client_secret,
      code_challenge,
      state: claudeState,
      redirect_uri: claudeRedirectUri,
    } = req.body as Record<string, string>;

    if (!sc_client_id || !sc_client_secret || !code_challenge || !claudeState || !claudeRedirectUri) {
      res.status(400).send("Missing required fields.");
      return;
    }

    const scState = storePKCEState({
      code_challenge,
      sc_client_id,
      sc_client_secret,
      claude_redirect_uri: claudeRedirectUri,
      claude_state: claudeState,
    });

    const scRedirectUri =
      process.env.SOUNDCLOUD_REDIRECT_URI ??
      `${publicUrl}/soundcloud/callback`;

    const params = new URLSearchParams({
      client_id: sc_client_id,
      redirect_uri: scRedirectUri,
      response_type: "code",
      state: scState,
      scope: "non-expiring",
    });

    res.redirect(`${SC_AUTH_URL}?${params}`);
  });

  // GET /soundcloud/callback — exchange SC code for tokens, redirect back to Claude
  router.get("/soundcloud/callback", async (req, res) => {
    const { code, state: scState, error } = req.query as Record<string, string>;

    if (error) {
      res.status(400).send(`SoundCloud authorization error: ${escHtml(error)}`);
      return;
    }

    if (!code || !scState) {
      res.status(400).send("Missing code or state.");
      return;
    }

    const pkce = getPKCEState(scState);
    if (!pkce) {
      res.status(400).send("Authorization session expired or invalid. Please try again.");
      return;
    }

    const scRedirectUri =
      process.env.SOUNDCLOUD_REDIRECT_URI ??
      `${publicUrl}/soundcloud/callback`;

    try {
      const tokenRes = await fetch(SC_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: pkce.sc_client_id,
          client_secret: pkce.sc_client_secret,
          redirect_uri: scRedirectUri,
          code,
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text().catch(() => "");
        res.status(502).send(`Failed to obtain SoundCloud token: ${escHtml(body)}`);
        return;
      }

      const scTokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      deletePKCEState(scState);

      const mcpAuthCode = storeAuthCodeSession({
        sc_access_token: scTokens.access_token,
        sc_refresh_token: scTokens.refresh_token,
        sc_expires_in: scTokens.expires_in,
        sc_client_id: pkce.sc_client_id,
        sc_client_secret: pkce.sc_client_secret,
        code_challenge: pkce.code_challenge,
        redirect_uri: pkce.claude_redirect_uri,
      });

      const redirectParams = new URLSearchParams({
        code: mcpAuthCode,
        state: pkce.claude_state,
      });

      res.redirect(`${pkce.claude_redirect_uri}?${redirectParams}`);
    } catch (err) {
      console.error("SoundCloud token exchange error:", err);
      res.status(502).send("Internal error during token exchange.");
    }
  });

  // POST /oauth/token — exchange MCP auth code for tokens (or refresh)
  router.post("/oauth/token", async (req, res) => {
    const { grant_type } = req.body as Record<string, string>;

    if (grant_type === "authorization_code") {
      const { code, code_verifier, redirect_uri } = req.body as Record<
        string,
        string
      >;

      if (!code || !code_verifier) {
        res.status(400).json({ error: "invalid_request", error_description: "Missing code or code_verifier." });
        return;
      }

      const session = getAuthCodeSession(code);
      if (!session) {
        res.status(400).json({ error: "invalid_grant", error_description: "Authorization code expired or invalid." });
        return;
      }

      if (!verifyPKCE(code_verifier, session.code_challenge)) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed." });
        return;
      }

      deleteAuthCodeSession(code);

      const refreshToken = encodeRefreshToken({
        rt: session.sc_refresh_token,
        ci: session.sc_client_id,
        cs: session.sc_client_secret,
      });

      res.json({
        access_token: session.sc_access_token,
        token_type: "Bearer",
        expires_in: session.sc_expires_in,
        refresh_token: refreshToken,
        scope: "",
      });
      return;
    }

    if (grant_type === "refresh_token") {
      const { refresh_token } = req.body as Record<string, string>;

      if (!refresh_token) {
        res.status(400).json({ error: "invalid_request", error_description: "Missing refresh_token." });
        return;
      }

      const payload = decodeRefreshToken(refresh_token);
      if (!payload) {
        res.status(400).json({ error: "invalid_grant", error_description: "Invalid refresh_token." });
        return;
      }

      const scRedirectUri =
        process.env.SOUNDCLOUD_REDIRECT_URI ??
        `${publicUrl}/soundcloud/callback`;

      try {
        const tokenRes = await fetch(SC_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: payload.ci,
            client_secret: payload.cs,
            refresh_token: payload.rt,
          }),
        });

        if (!tokenRes.ok) {
          const body = await tokenRes.text().catch(() => "");
          res.status(400).json({
            error: "invalid_grant",
            error_description: `SoundCloud token refresh failed: ${body}`,
          });
          return;
        }

        const scTokens = (await tokenRes.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        const newRefreshToken = encodeRefreshToken({
          rt: scTokens.refresh_token,
          ci: payload.ci,
          cs: payload.cs,
        });

        res.json({
          access_token: scTokens.access_token,
          token_type: "Bearer",
          expires_in: scTokens.expires_in,
          refresh_token: newRefreshToken,
          scope: "",
        });
      } catch (err) {
        console.error("Token refresh error:", err);
        res.status(502).json({ error: "server_error", error_description: "Token refresh failed." });
      }
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });

  return router;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
