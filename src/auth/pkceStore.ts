/*
 * Copyright (C) 2026 Marcell Kehmstedt
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomBytes } from "crypto";
import type { PKCEState, AuthCodeSession } from "../types.js";

const PKCE_TTL_MS = 5 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;

const pkceStates = new Map<string, PKCEState>();
const authCodeSessions = new Map<string, AuthCodeSession>();

function generateId(): string {
  return randomBytes(32).toString("hex");
}

function evictExpired<T extends { created_at: number }>(
  store: Map<string, T>,
  ttl: number
): void {
  const now = Date.now();
  for (const [key, value] of store) {
    if (now - value.created_at > ttl) store.delete(key);
  }
}

export function storePKCEState(
  state: Omit<PKCEState, "created_at">
): string {
  evictExpired(pkceStates, PKCE_TTL_MS);
  const id = generateId();
  pkceStates.set(id, { ...state, created_at: Date.now() });
  return id;
}

export function getPKCEState(id: string): PKCEState | null {
  const entry = pkceStates.get(id);
  if (!entry) return null;
  if (Date.now() - entry.created_at > PKCE_TTL_MS) {
    pkceStates.delete(id);
    return null;
  }
  return entry;
}

export function deletePKCEState(id: string): void {
  pkceStates.delete(id);
}

export function storeAuthCodeSession(
  session: Omit<AuthCodeSession, "created_at">
): string {
  evictExpired(authCodeSessions, AUTH_CODE_TTL_MS);
  const code = generateId();
  authCodeSessions.set(code, { ...session, created_at: Date.now() });
  return code;
}

export function getAuthCodeSession(code: string): AuthCodeSession | null {
  const entry = authCodeSessions.get(code);
  if (!entry) return null;
  if (Date.now() - entry.created_at > AUTH_CODE_TTL_MS) {
    authCodeSessions.delete(code);
    return null;
  }
  return entry;
}

export function deleteAuthCodeSession(code: string): void {
  authCodeSessions.delete(code);
}
