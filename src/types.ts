/*
 * Copyright (C) 2026 Marcell Kehmstedt
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface Track {
  id: number;
  title: string;
  description: string | null;
  duration: number;
  genre: string | null;
  tag_list: string;
  downloadable: boolean;
  permalink_url: string;
  artwork_url: string | null;
  user: {
    id: number;
    username: string;
    permalink_url: string;
  };
  playback_count: number;
  likes_count: number;
}

export interface Playlist {
  id: number;
  title: string;
  description: string | null;
  is_public: boolean;
  track_count: number;
  duration: number;
  permalink_url: string;
  artwork_url: string | null;
  user: {
    id: number;
    username: string;
    permalink_url: string;
  };
  tracks?: Track[];
}

export interface StreamUrls {
  http_mp3_128_url: string;
  https_mp3_128_url?: string;
}

export interface SoundCloudApiError {
  error: true;
  code: "UNAUTHORIZED" | "NOT_FOUND" | "RATE_LIMITED" | "API_ERROR";
  message: string;
  retry_after?: number;
}

export interface PKCEState {
  code_challenge: string;
  sc_client_id: string;
  sc_client_secret: string;
  claude_redirect_uri: string;
  claude_state: string;
  created_at: number;
}

export interface AuthCodeSession {
  sc_access_token: string;
  sc_refresh_token: string;
  sc_expires_in: number;
  sc_client_id: string;
  sc_client_secret: string;
  code_challenge: string;
  redirect_uri: string;
  created_at: number;
}

export interface RefreshTokenPayload {
  rt: string;
  ci: string;
  cs: string;
}

declare global {
  namespace Express {
    interface Request {
      soundcloudToken?: string;
    }
  }
}
