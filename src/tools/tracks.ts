/*
 * Copyright (C) 2026 Marcell Kehmstedt
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  searchTracks,
  getTrack,
  getStreamUrls,
  toErrorPayload,
} from "../soundcloud/client.js";

type TextContent = { type: "text"; text: string };

function json(value: unknown): TextContent {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

export function registerTrackTools(server: McpServer, token: string): void {
  server.tool(
    "search_tracks",
    "Search for tracks on SoundCloud by query, with optional genre filter.",
    {
      query: z.string().describe("Search keywords"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (1-50, default 10)"),
      genre: z.string().optional().describe("Filter by genre"),
    },
    async ({ query, limit, genre }) => {
      try {
        const tracks = await searchTracks(token, query, limit ?? 10, genre);
        return { content: [json({ tracks })] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "get_track",
    "Get detailed information about a single SoundCloud track.",
    {
      track_id: z.number().int().describe("SoundCloud track ID"),
    },
    async ({ track_id }) => {
      try {
        const track = await getTrack(token, track_id);
        return { content: [json(track)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "get_stream_url",
    "Get the MP3 stream URL for a SoundCloud track.",
    {
      track_id: z.number().int().describe("SoundCloud track ID"),
    },
    async ({ track_id }) => {
      try {
        const urls = await getStreamUrls(token, track_id);
        const streamUrl = urls.http_mp3_128_url;
        return {
          content: [
            json({
              stream_url: streamUrl,
              expires_in_seconds: 3600,
            }),
          ],
        };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );
}
