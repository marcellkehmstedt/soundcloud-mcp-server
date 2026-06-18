/*
 * Copyright (C) 2026 Marcell Kehmstedt
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  createPlaylist,
  updatePlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
} from "./client.js";

// Track IDs that triggered the original 422: any value above 2^31 - 1.
const BIG_ID_A = "2331097010";
const BIG_ID_B = "2248505789";
const SMALL_ID = "472783614";

type RecordedCall = {
  url: string;
  method: string;
  body: unknown;
};

const realFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

/**
 * Replace global fetch with a recorder. Each entry queued in `responses` is a
 * (body, init) pair returned in order; reads/PUTs that aren't queued get a
 * default empty playlist so the code under test can proceed.
 */
function installFetchMock(responseBodies: unknown[]): void {
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = undefined;
    if (typeof init?.body === "string") {
      // This is the contract under test: the outgoing body must be valid JSON.
      parsedBody = JSON.parse(init.body);
    }
    calls.push({ url, method, body: parsedBody });

    const responseBody = responseBodies[i++] ?? {};
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Pull the JSON body of the first call matching method. */
function bodyOf(method: string): any {
  const call = calls.find((c) => c.method === method);
  assert.ok(call, `expected a ${method} request to have been made`);
  return call!.body;
}

test("createPlaylist serialises large IDs as strings in a valid JSON body", async () => {
  installFetchMock([{ id: 1, title: "t" }]);

  await createPlaylist("tok", "My Playlist", false, [BIG_ID_A, BIG_ID_B]);

  const body = bodyOf("POST");
  assert.deepEqual(body.playlist.tracks, [
    { id: BIG_ID_A },
    { id: BIG_ID_B },
  ]);
  // Every id must be a JSON string, never a number.
  for (const t of body.playlist.tracks) {
    assert.equal(typeof t.id, "string");
  }
});

test("createPlaylist still works for small IDs (regression)", async () => {
  installFetchMock([{ id: 1 }]);

  await createPlaylist("tok", "Small", false, [SMALL_ID]);

  const body = bodyOf("POST");
  assert.deepEqual(body.playlist.tracks, [{ id: SMALL_ID }]);
  assert.equal(typeof body.playlist.tracks[0].id, "string");
});

test("createPlaylist handles a mixed batch of small and large IDs", async () => {
  installFetchMock([{ id: 1 }]);

  await createPlaylist("tok", "Mixed", true, [SMALL_ID, BIG_ID_A]);

  const body = bodyOf("POST");
  assert.deepEqual(body.playlist.tracks, [
    { id: SMALL_ID },
    { id: BIG_ID_A },
  ]);
  assert.equal(body.playlist.sharing, "public");
});

test("updatePlaylist sends string IDs on track replacement", async () => {
  installFetchMock([{ id: 1 }]);

  await updatePlaylist("tok", 99, { track_ids: [BIG_ID_A, SMALL_ID] });

  const body = bodyOf("PUT");
  assert.deepEqual(body.playlist.tracks, [
    { id: BIG_ID_A },
    { id: SMALL_ID },
  ]);
});

test("addTracksToPlaylist merges existing numeric IDs with new large IDs as strings", async () => {
  // 1st fetch: GET existing playlist (SoundCloud returns numeric IDs).
  // 2nd fetch: PUT update.
  installFetchMock([
    { id: 99, tracks: [{ id: Number(SMALL_ID) }] },
    { id: 99 },
  ]);

  await addTracksToPlaylist("tok", 99, [BIG_ID_A, BIG_ID_B]);

  const body = bodyOf("PUT");
  const ids = body.playlist.tracks.map((t: { id: string }) => t.id);
  assert.deepEqual(ids, [SMALL_ID, BIG_ID_A, BIG_ID_B]);
  for (const t of body.playlist.tracks) {
    assert.equal(typeof t.id, "string");
  }
});

test("addTracksToPlaylist dedups an already-present large ID", async () => {
  installFetchMock([
    { id: 99, tracks: [{ id: Number(BIG_ID_A) }] },
    { id: 99 },
  ]);

  await addTracksToPlaylist("tok", 99, [BIG_ID_A, BIG_ID_B]);

  const ids = bodyOf("PUT").playlist.tracks.map((t: { id: string }) => t.id);
  assert.deepEqual(ids, [BIG_ID_A, BIG_ID_B]);
});

test("removeTrackFromPlaylist drops the target large ID and keeps the rest as strings", async () => {
  installFetchMock([
    {
      id: 99,
      tracks: [{ id: Number(SMALL_ID) }, { id: Number(BIG_ID_A) }],
    },
    { id: 99 },
  ]);

  await removeTrackFromPlaylist("tok", 99, BIG_ID_A);

  const ids = bodyOf("PUT").playlist.tracks.map((t: { id: string }) => t.id);
  assert.deepEqual(ids, [SMALL_ID]);
  assert.equal(typeof bodyOf("PUT").playlist.tracks[0].id, "string");
});
