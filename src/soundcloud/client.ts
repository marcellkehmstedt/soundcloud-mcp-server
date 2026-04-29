import type {
  Track,
  Playlist,
  StreamUrls,
  SoundCloudApiError,
} from "../types.js";
import { dbg } from "../debug.js";

const SC_API = "https://api.soundcloud.com";
const SC_TIMEOUT_MS = 15_000;

class SoundCloudError extends Error {
  constructor(public readonly payload: SoundCloudApiError) {
    super(payload.message);
  }
}

async function scFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${SC_API}${path}`;
  const method = (options.method ?? "GET").toUpperCase();

  dbg("SC", `→ ${method} ${url} (token: ${token.length} chars)`);
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(SC_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json; charset=utf-8",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    const ms = Date.now() - t0;
    dbg("SC", `✗ ${method} ${url} — ${ms}ms —`, err instanceof Error ? err.message : String(err));
    throw err;
  }

  const ms = Date.now() - t0;
  dbg("SC", `← ${res.status} ${method} ${url} — ${ms}ms`);
  return res;
}

// SoundCloud list endpoints return { collection: T[], next_href: string|null }
// rather than a plain array. Unwrap if needed.
function unwrapCollection<T>(body: unknown): T {
  if (body && typeof body === "object" && "collection" in body) {
    return (body as { collection: T }).collection;
  }
  return body as T;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    const body = await res.json();
    return unwrapCollection<T>(body);
  }

  if (res.status === 401) {
    throw new SoundCloudError({
      error: true,
      code: "UNAUTHORIZED",
      message: "Invalid or expired SoundCloud access token.",
    });
  }
  if (res.status === 404) {
    throw new SoundCloudError({
      error: true,
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
  }
  if (res.status === 429) {
    const retryAfter = parseInt(
      res.headers.get("retry-after") ?? "60",
      10
    );
    throw new SoundCloudError({
      error: true,
      code: "RATE_LIMITED",
      message: "SoundCloud rate limit exceeded.",
      retry_after: retryAfter,
    });
  }

  const body = await res.text().catch(() => "");
  throw new SoundCloudError({
    error: true,
    code: "API_ERROR",
    message: `SoundCloud API error ${res.status}: ${body}`,
  });
}

export function isSoundCloudError(err: unknown): err is SoundCloudError {
  return err instanceof SoundCloudError;
}

export function toErrorPayload(err: unknown): SoundCloudApiError {
  if (isSoundCloudError(err)) return err.payload;
  return {
    error: true,
    code: "API_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}

export async function searchTracks(
  token: string,
  query: string,
  limit = 10,
  genre?: string
): Promise<Track[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (genre) params.set("genres", genre);
  const res = await scFetch(`/tracks?${params}`, token);
  return handleResponse<Track[]>(res);
}

export async function getTrack(token: string, trackId: number): Promise<Track> {
  const res = await scFetch(`/tracks/${trackId}`, token);
  return handleResponse<Track>(res);
}

export async function getStreamUrls(
  token: string,
  trackId: number
): Promise<StreamUrls> {
  const res = await scFetch(`/tracks/${trackId}/streams`, token);
  return handleResponse<StreamUrls>(res);
}

export async function getMyPlaylists(token: string): Promise<Playlist[]> {
  const res = await scFetch("/me/playlists", token);
  return handleResponse<Playlist[]>(res);
}

export async function getPlaylist(
  token: string,
  playlistId: number
): Promise<Playlist> {
  const res = await scFetch(`/playlists/${playlistId}`, token);
  return handleResponse<Playlist>(res);
}

export async function createPlaylist(
  token: string,
  title: string,
  isPublic = false,
  trackIds: number[] = [],
  description?: string
): Promise<Playlist> {
  const body = {
    playlist: {
      title,
      sharing: isPublic ? "public" : "private",
      ...(description ? { description } : {}),
      tracks: trackIds.map((id) => ({ id })),
    },
  };
  const res = await scFetch("/playlists", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<Playlist>(res);
}

export async function updatePlaylist(
  token: string,
  playlistId: number,
  updates: {
    title?: string;
    description?: string;
    is_public?: boolean;
    track_ids?: number[];
  }
): Promise<Playlist> {
  const playlist: Record<string, unknown> = {};
  if (updates.title !== undefined) playlist.title = updates.title;
  if (updates.description !== undefined)
    playlist.description = updates.description;
  if (updates.is_public !== undefined)
    playlist.sharing = updates.is_public ? "public" : "private";
  if (updates.track_ids !== undefined)
    playlist.tracks = updates.track_ids.map((id) => ({ id }));

  const res = await scFetch(`/playlists/${playlistId}`, token, {
    method: "PUT",
    body: JSON.stringify({ playlist }),
  });
  return handleResponse<Playlist>(res);
}

export async function addTracksToPlaylist(
  token: string,
  playlistId: number,
  newTrackIds: number[]
): Promise<Playlist> {
  const existing = await getPlaylist(token, playlistId);
  const existingIds = (existing.tracks ?? []).map((t) => t.id);
  const merged = [...new Set([...existingIds, ...newTrackIds])];
  return updatePlaylist(token, playlistId, { track_ids: merged });
}

export async function removeTrackFromPlaylist(
  token: string,
  playlistId: number,
  trackId: number
): Promise<Playlist> {
  const existing = await getPlaylist(token, playlistId);
  const filtered = (existing.tracks ?? [])
    .map((t) => t.id)
    .filter((id) => id !== trackId);
  return updatePlaylist(token, playlistId, { track_ids: filtered });
}

export async function deletePlaylist(
  token: string,
  playlistId: number
): Promise<void> {
  const res = await scFetch(`/playlists/${playlistId}`, token, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) await handleResponse(res);
}
