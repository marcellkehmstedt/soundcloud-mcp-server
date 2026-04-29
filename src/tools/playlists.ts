/*
 * Copyright (C) 2026 Marcell Kehmstedt
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getMyPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
  toErrorPayload,
} from "../soundcloud/client.js";

type TextContent = { type: "text"; text: string };

function json(value: unknown): TextContent {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

export function registerPlaylistTools(server: McpServer, token: string): void {
  server.tool(
    "get_my_playlists",
    "Get all playlists owned by the authenticated SoundCloud user.",
    {},
    async () => {
      try {
        const playlists = await getMyPlaylists(token);
        return { content: [json({ playlists })] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "get_playlist",
    "Get a SoundCloud playlist by ID, including its tracks.",
    {
      playlist_id: z.number().int().describe("SoundCloud playlist ID"),
    },
    async ({ playlist_id }) => {
      try {
        const playlist = await getPlaylist(token, playlist_id);
        return { content: [json(playlist)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "create_playlist",
    "Create a new SoundCloud playlist.",
    {
      title: z.string().describe("Playlist title"),
      is_public: z.boolean().optional().describe("Public playlist (default false)"),
      track_ids: z.array(z.number().int()).optional().describe("Initial track IDs"),
      description: z.string().optional().describe("Playlist description"),
    },
    async ({ title, is_public, track_ids, description }) => {
      try {
        const playlist = await createPlaylist(
          token,
          title,
          is_public ?? false,
          track_ids ?? [],
          description
        );
        return { content: [json(playlist)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "update_playlist",
    "Update an existing SoundCloud playlist.",
    {
      playlist_id: z.number().int().describe("Playlist ID to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      is_public: z.boolean().optional().describe("Change visibility"),
      track_ids: z
        .array(z.number().int())
        .optional()
        .describe("Replace track list with these IDs"),
    },
    async ({ playlist_id, title, description, is_public, track_ids }) => {
      try {
        const playlist = await updatePlaylist(token, playlist_id, {
          title,
          description,
          is_public,
          track_ids,
        });
        return { content: [json(playlist)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "add_tracks_to_playlist",
    "Append tracks to an existing SoundCloud playlist without replacing existing ones.",
    {
      playlist_id: z.number().int().describe("Playlist ID"),
      track_ids: z.array(z.number().int()).describe("Track IDs to add"),
    },
    async ({ playlist_id, track_ids }) => {
      try {
        const playlist = await addTracksToPlaylist(token, playlist_id, track_ids);
        return { content: [json(playlist)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "remove_track_from_playlist",
    "Remove a single track from a SoundCloud playlist.",
    {
      playlist_id: z.number().int().describe("Playlist ID"),
      track_id: z.number().int().describe("Track ID to remove"),
    },
    async ({ playlist_id, track_id }) => {
      try {
        const playlist = await removeTrackFromPlaylist(
          token,
          playlist_id,
          track_id
        );
        return { content: [json(playlist)] };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );

  server.tool(
    "delete_playlist",
    "Permanently delete a SoundCloud playlist.",
    {
      playlist_id: z.number().int().describe("Playlist ID to delete"),
    },
    async ({ playlist_id }) => {
      try {
        await deletePlaylist(token, playlist_id);
        return {
          content: [
            json({ success: true, playlist_id, message: "Playlist deleted." }),
          ],
        };
      } catch (err) {
        return { isError: true, content: [json(toErrorPayload(err))] };
      }
    }
  );
}
