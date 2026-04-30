# SoundCloud MCP Server

An MCP (Model Context Protocol) server that gives Claude access to your SoundCloud library. Connect it to Claude Web and manage your playlists and tracks through natural language.

## Features

| Tool | Description |
|---|---|
| `get_my_playlists` | List all your playlists |
| `get_playlist` | Get a playlist with its full tracklist |
| `create_playlist` | Create a new playlist |
| `update_playlist` | Rename, redescribe, or reorder a playlist |
| `add_tracks_to_playlist` | Append tracks to an existing playlist |
| `remove_track_from_playlist` | Remove a track from a playlist |
| `delete_playlist` | Delete a playlist permanently |
| `search_tracks` | Search SoundCloud tracks by keyword and genre |
| `get_track` | Get details for a specific track |
| `get_stream_url` | Get a direct MP3 stream URL for a track (personal/authorized listening only — see [Usage notes](#usage-notes)) |

## Prerequisites

- A SoundCloud developer app — register at [soundcloud.com/you/apps](https://soundcloud.com/you/apps)
- A publicly reachable server with HTTPS (required by Claude Web)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/marcellkehmstedt/soundcloud-mcp-server
cd soundcloud-mcp-server
npm install
npm run build
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | Yes | Public HTTPS URL of your server, e.g. `https://mcp.example.com` |
| `SOUNDCLOUD_REDIRECT_URI` | Yes | Must be `{PUBLIC_URL}/soundcloud/callback` |
| `PORT` | No | Port to listen on (default: `3000`) |
| `MCP_DEBUG` | No | Set to `true` to enable verbose debug logging to stderr |
| `UI_BRAND_COLOR` | No | Accent color of the login UI (hex `#rrggbb`, default `#3b82f6`) |

### 3. Run

**Directly:**
```bash
npm start
```

**With Docker Compose:**
```bash
# Edit PUBLIC_URL and SOUNDCLOUD_REDIRECT_URI in docker-compose.yml first
docker compose up -d
```

## Connect to Claude Web

1. Open **Claude Web → Settings → Integrations → Add integration**
2. Enter your server URL:
   ```
   https://your-domain.com/mcp
   ```
3. Claude will redirect you to a login form — enter your SoundCloud **Client ID** and **Client Secret** from [soundcloud.com/you/apps](https://soundcloud.com/you/apps)
4. Authorize the app on SoundCloud
5. You're connected — Claude can now use your SoundCloud tools

> Your SoundCloud credentials are never stored on the server. The access token is issued to Claude directly and used only for API calls.

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `POST /mcp` | MCP Streamable HTTP endpoint (used by Claude) |
| `GET /diagnostic` | Test your SoundCloud token directly (see below) |
| `GET /.well-known/oauth-authorization-server` | OAuth metadata (RFC 8414) |
| `GET /.well-known/oauth-protected-resource` | Resource metadata (RFC 9728) |

### Diagnostic endpoint

If a tool is not returning results, use this to verify your SoundCloud token works:

```bash
curl https://your-domain.com/diagnostic \
  -H "Authorization: Bearer <your-soundcloud-access-token>"
```

Returns the HTTP status of `GET /me` and `GET /me/playlists` so you can tell immediately whether the issue is in the token, the API, or the server.

## Debug logging

Enable with `MCP_DEBUG=true`. Logs go to stderr and cover:

- MCP session lifecycle (create / close)
- Every JSON-RPC method call and parameters
- SoundCloud API requests: method, URL, status, latency, body-read timing

```
[MCP] new session abc123
[MCP] → tools/call {"name":"get_my_playlists","arguments":{}}
[MCP] session abc123 — POST
[SC] → GET https://api.soundcloud.com/me/playlists (token: 47 chars)
[SC] ← 200 GET https://api.soundcloud.com/me/playlists — 312ms
[SC] reading body (content-length: 18432)
[SC] body parsed
```

## Architecture

```
Claude Web
    │  OAuth 2.0 (RFC 6749 + PKCE)
    │  MCP Streamable HTTP (2025-03-26)
    ▼
Express server
    ├── /.well-known/*     OAuth discovery (RFC 8414 + RFC 9728)
    ├── /register          Dynamic Client Registration (RFC 7591)
    ├── /oauth/authorize   Login form → SoundCloud OAuth redirect
    ├── /soundcloud/callback  Token exchange
    ├── /oauth/token       Issue / refresh MCP access tokens
    └── /mcp               MCP tools (StreamableHTTPServerTransport)
            │
            ▼
    SoundCloud API (api.soundcloud.com)
```

**Token flow:** Claude Web completes a PKCE OAuth flow against this server. The server exchanges Claude's auth code for a SoundCloud access token and passes it straight through as the MCP Bearer token. Each MCP session uses the token to call the SoundCloud API on Claude's behalf.

## Usage notes

- `get_stream_url` returns the direct MP3 URL that the SoundCloud API exposes for an authorized user. It is intended for **personal, authorized listening only**. Do not use it to re-host, re-distribute, or publicly broadcast tracks. Each user is responsible for complying with the [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use).
- Each deployer registers their own SoundCloud developer app and supplies their own `client_id` / `client_secret` via the login form — the server never stores these credentials at rest.

## Disclaimer

This is an **unofficial integration**. This project is not affiliated with, endorsed by, or sponsored by SoundCloud Limited. "SoundCloud" is a trademark of SoundCloud Limited, used here solely in a descriptive sense to refer to the third-party API this software interacts with.

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

See the [LICENSE](./LICENSE) file for the full license text.

Copyright (C) 2026 Marcell Kehmstedt.
