// Verwaltung aller Räume: Raumcodes, Player-Tokens, Verbindungsstatus, Ablauf
// und die Trennung von öffentlichem und geheimem State.

import { randomBytes, randomUUID } from "node:crypto";
import { TEAM_IDS, type AiStatus, type PlayerState, type PublicCard, type PublicState, type TeamId } from "../shared/types.js";
import { activeClue, createRoom, missingTeam, remainingCards, type Room } from "./game.js";

export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
// Ohne I und O, damit Codes nicht mit 1 und 0 verwechselt werden.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** Ohne Profil `ki`: Moduswahl wird nicht angeboten. */
export const AI_DISABLED: AiStatus = { enabled: false, ready: false };

export interface RoomEntry {
  room: Room;
  /** Basis-URL, unter der Handys den Server erreichen (z. B. http://192.168.1.20:8080). */
  baseUrl: string;
  /** Anzahl verbundener Sockets je Rolle. */
  screens: number;
  playerSockets: Record<TeamId, number>;
  /** Zeitpunkt, seit dem kein Gerät mehr verbunden ist. */
  emptySince?: number;
}

export function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
  } catch {
    return true;
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.rooms.size;
  }

  create(baseUrl: string, wordList: string): RoomEntry {
    let code: string;
    do {
      code = Array.from(randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    } while (this.rooms.has(code));
    const entry: RoomEntry = {
      room: createRoom(code, wordList),
      baseUrl,
      screens: 0,
      playerSockets: { a: 0, b: 0 },
      emptySince: this.now(),
    };
    this.rooms.set(code, entry);
    return entry;
  }

  entries(): IterableIterator<RoomEntry> {
    return this.rooms.values();
  }

  get(code: unknown): RoomEntry | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  static newToken(): string {
    return randomUUID();
  }

  isConnected(entry: RoomEntry, team: TeamId): boolean {
    return Boolean(entry.room.players[team]) && entry.playerSockets[team] > 0;
  }

  bothPlayersConnected(entry: RoomEntry): boolean {
    return TEAM_IDS.every((team) => this.isConnected(entry, team));
  }

  connect(entry: RoomEntry, role: "screen" | TeamId): void {
    if (role === "screen") entry.screens++;
    else entry.playerSockets[role]++;
    entry.emptySince = undefined;
  }

  disconnect(entry: RoomEntry, role: "screen" | TeamId): void {
    if (role === "screen") entry.screens = Math.max(0, entry.screens - 1);
    else entry.playerSockets[role] = Math.max(0, entry.playerSockets[role] - 1);
    if (entry.screens === 0 && entry.playerSockets.a === 0 && entry.playerSockets.b === 0) {
      entry.emptySince = this.now();
    }
  }

  /** Löscht Räume, an denen seit mindestens 2 Stunden kein Gerät hängt. Liefert die gelöschten Codes. */
  sweep(): string[] {
    const removed: string[] = [];
    const cutoff = this.now() - ROOM_TTL_MS;
    for (const [code, entry] of this.rooms) {
      if (entry.emptySince !== undefined && entry.emptySince <= cutoff) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  joinUrl(entry: RoomEntry): string {
    return `${entry.baseUrl}/join/${entry.room.code}`;
  }

  /** Öffentlicher State: der Typ einer Karte nur, wenn sie aufgedeckt ist. */
  publicState(entry: RoomEntry, wordLists: string[], ai: AiStatus = AI_DISABLED): PublicState {
    const { room } = entry;
    const cards: PublicCard[] = room.cards.map((card) =>
      card.revealed ? { word: card.word, revealed: true, type: card.type } : { word: card.word, revealed: false },
    );
    const joinUrl = this.joinUrl(entry);
    return {
      code: room.code,
      phase: room.phase,
      teams: { a: { ...room.teams.a }, b: { ...room.teams.b } },
      cards,
      startingTeam: room.startingTeam,
      currentTeam: room.currentTeam,
      winner: room.winner,
      winReason: room.winReason,
      remaining: remainingCards(room),
      slots: { a: Boolean(room.players.a), b: Boolean(room.players.b) },
      connected: { a: this.isConnected(entry, "a"), b: this.isConnected(entry, "b") },
      waitingFor: room.phase === "paused" ? missingTeam(room) : undefined,
      canUndo: room.mode !== "ai" && room.history.length > 0,
      wordList: room.wordList,
      wordLists,
      joinUrl,
      joinUrlIsLocal: isLocalUrl(joinUrl),
      mode: room.mode,
      aiEnabled: ai.enabled,
      aiAvailable: ai.enabled && ai.ready,
      aiUnavailableReason: ai.enabled && !ai.ready ? ai.reason : undefined,
      currentClue: activeClue(room),
      aiThinking: room.aiThinking,
      aiThought: room.aiThought,
      aiThoughtTeam: room.aiThoughtTeam,
    };
  }

  /** State für einen authentifizierten Player: zusätzlich die komplette geheime Karte. */
  playerState(entry: RoomEntry, team: TeamId, wordLists: string[], ai: AiStatus = AI_DISABLED): PlayerState {
    return {
      ...this.publicState(entry, wordLists, ai),
      team,
      key: entry.room.cards.map((card) => card.type),
    };
  }
}
