import { io, type Socket } from "socket.io-client";
import type { Ack, Action, ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: AppSocket = io();

/** Sendet ein Event mit Bestätigung und wartet auf die Antwort des Servers. */
export function request<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => {
    (socket.timeout(5000).emit as (...a: unknown[]) => void)(event, ...args, (err: unknown, res: Ack<T>) => {
      resolve(err ? { ok: false, error: "Keine Antwort vom Server." } : res);
    });
  });
}

export const sendAction = (action: Action) => request("action", action);

const tokenKey = (code: string) => `codenames-luii:token:${code}`;

export function loadToken(code: string): string | undefined {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(code: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    // Ohne localStorage klappt nur die Wiederverbindung nach Neuladen nicht.
  }
}

export function clearToken(code: string): void {
  try {
    localStorage.removeItem(tokenKey(code));
  } catch {
    // ignorieren
  }
}
