// Reine Spiellogik ohne Netzwerk. Jede Funktion verändert den übergebenen Raum
// und liefert bei ungültigen Aktionen einen Fehler, ohne etwas zu ändern.

import {
  MAX_TEAM_NAME_LENGTH,
  PALETTE,
  TEAM_IDS,
  type CardType,
  type PaletteColor,
  type Phase,
  type TeamConfig,
  type TeamId,
  type WinReason,
} from "../shared/types.js";
import { shuffle, type Random } from "./random.js";

export const GRID_SIZE = 25;
export const STARTING_TEAM_CARDS = 9;
export const OTHER_TEAM_CARDS = 8;
export const NEUTRAL_CARDS = 7;

export type { Random };
export type Result = { ok: true } | { ok: false; error: string };

export interface Card {
  word: string;
  type: CardType; // geheim
  revealed: boolean;
}

/** Zustand unmittelbar vor einer Aufdeckung, für Undo. */
export interface RevealAction {
  index: number;
  phase: Phase;
  currentTeam: TeamId;
  winner?: TeamId;
  winReason?: WinReason;
}

export interface Room {
  code: string;
  phase: Phase;
  teams: Record<TeamId, TeamConfig>;
  cards: Card[];
  startingTeam: TeamId;
  currentTeam: TeamId;
  winner?: TeamId;
  winReason?: WinReason;
  players: Partial<Record<TeamId, string>>; // Player-Tokens
  history: RevealAction[];
  wordList: string;
}

const ok: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });

export const otherTeam = (team: TeamId): TeamId => (team === "a" ? "b" : "a");

export function defaultTeams(): Record<TeamId, TeamConfig> {
  return {
    a: { name: "Team Rot", color: "red" },
    b: { name: "Team Blau", color: "blue" },
  };
}

export function createRoom(code: string, wordList: string): Room {
  return {
    code,
    phase: "lobby",
    teams: defaultTeams(),
    cards: [],
    startingTeam: "a",
    currentTeam: "a",
    players: {},
    history: [],
    wordList,
  };
}

/** Erzeugt 25 Karten: Startteam 9, anderes Team 8, 7 neutral, 1 Attentäter, zufällig verteilt. */
export function dealCards(words: readonly string[], startingTeam: TeamId, random: Random = Math.random): Card[] {
  if (words.length !== GRID_SIZE) throw new Error(`Es werden genau ${GRID_SIZE} Wörter gebraucht.`);
  const types: CardType[] = [
    ...Array<CardType>(STARTING_TEAM_CARDS).fill(startingTeam),
    ...Array<CardType>(OTHER_TEAM_CARDS).fill(otherTeam(startingTeam)),
    ...Array<CardType>(NEUTRAL_CARDS).fill("neutral"),
    "assassin",
  ];
  shuffle(types, random);
  return words.map((word, i) => ({ word, type: types[i], revealed: false }));
}

export function remainingCards(room: Room): Record<TeamId, number> {
  const remaining = { a: 0, b: 0 };
  for (const card of room.cards) {
    if (!card.revealed && (card.type === "a" || card.type === "b")) remaining[card.type]++;
  }
  return remaining;
}

/** Ein Spiel läuft (ggf. pausiert): Spielfeld existiert, kein Gewinner. */
const inGame = (room: Room) => room.phase === "playing" || room.phase === "paused";

/** Erstes Team ohne Vorgeber-Slot, oder undefined. */
export function missingTeam(room: Room): TeamId | undefined {
  return TEAM_IDS.find((team) => !room.players[team]);
}

/** Pausiert ein laufendes Spiel, solange ein Vorgeber-Slot frei ist, und setzt es sonst fort. */
function syncPause(room: Room): void {
  if (!inGame(room)) return;
  room.phase = missingTeam(room) ? "paused" : "playing";
}

export function updateTeam(room: Room, team: TeamId, changes: { name?: unknown; color?: unknown }): Result {
  if (room.phase !== "lobby") return fail("Teams können nur in der Lobby angepasst werden.");
  if (!TEAM_IDS.includes(team)) return fail("Unbekanntes Team.");
  const next: TeamConfig = { ...room.teams[team] };

  if (changes.name !== undefined) {
    if (typeof changes.name !== "string") return fail("Ungültiger Teamname.");
    const name = changes.name.trim().replace(/\s+/g, " ");
    if (!name) return fail("Der Teamname darf nicht leer sein.");
    if ([...name].length > MAX_TEAM_NAME_LENGTH) {
      return fail(`Der Teamname darf höchstens ${MAX_TEAM_NAME_LENGTH} Zeichen haben.`);
    }
    next.name = name;
  }

  if (changes.color !== undefined) {
    if (!PALETTE.includes(changes.color as PaletteColor)) return fail("Diese Farbe gibt es nicht.");
    if (room.teams[otherTeam(team)].color === changes.color) {
      return fail("Beide Teams dürfen nicht dieselbe Farbe haben.");
    }
    next.color = changes.color as PaletteColor;
  }

  room.teams[team] = next;
  return ok;
}

export function setWordList(room: Room, wordList: string): Result {
  if (room.phase !== "lobby") return fail("Die Wortliste kann nur in der Lobby gewählt werden.");
  room.wordList = wordList;
  return ok;
}

/**
 * Startet eine Runde mit den gegebenen 25 Wörtern. Ob beide Vorgeber verbunden sind,
 * prüft der Aufrufer, weil das vom Verbindungsstatus abhängt.
 */
export function startGame(room: Room, words: readonly string[], random: Random = Math.random): Result {
  if (room.phase !== "lobby") return fail("Das Spiel läuft bereits.");
  if (missingTeam(room)) return fail("Beide Vorgeber müssen verbunden sein.");
  const startingTeam: TeamId = random() < 0.5 ? "a" : "b";
  room.cards = dealCards(words, startingTeam, random);
  room.startingTeam = startingTeam;
  room.currentTeam = startingTeam;
  room.winner = undefined;
  room.winReason = undefined;
  room.history = [];
  room.phase = "playing";
  return ok;
}

/** Prüft, ob `team` gerade am Zug handeln darf. */
function checkTurn(room: Room, team: TeamId): Result {
  if (room.phase === "paused") return fail("Das Spiel ist pausiert, bis ein neuer Vorgeber beigetreten ist.");
  if (room.phase !== "playing") return fail("Es läuft gerade kein Spiel.");
  if (room.currentTeam !== team) return fail("Dein Team ist nicht am Zug.");
  return ok;
}

export function reveal(room: Room, team: TeamId, index: number): Result {
  const turn = checkTurn(room, team);
  if (!turn.ok) return turn;
  if (!Number.isInteger(index) || index < 0 || index >= room.cards.length) return fail("Unbekannte Karte.");
  const card = room.cards[index];
  if (card.revealed) return fail("Diese Karte ist schon aufgedeckt.");

  room.history.push({
    index,
    phase: room.phase,
    currentTeam: room.currentTeam,
    winner: room.winner,
    winReason: room.winReason,
  });
  card.revealed = true;

  if (card.type === "assassin") {
    room.phase = "finished";
    room.winner = otherTeam(team);
    room.winReason = "assassin";
    return ok;
  }

  // Ein Team gewinnt, sobald alle seine Karten aufgedeckt sind, egal von wem.
  const remaining = remainingCards(room);
  const finishedTeam = remaining[team] === 0 ? team : remaining[otherTeam(team)] === 0 ? otherTeam(team) : undefined;
  if (finishedTeam) {
    room.phase = "finished";
    room.winner = finishedTeam;
    room.winReason = "allFound";
    return ok;
  }

  if (card.type !== team) room.currentTeam = otherTeam(team);
  return ok;
}

export function endTurn(room: Room, team: TeamId): Result {
  const turn = checkTurn(room, team);
  if (!turn.ok) return turn;
  room.currentTeam = otherTeam(team);
  return ok;
}

/** Macht die letzte Aufdeckung rückgängig, inklusive Zugwechsel oder Spielende. */
export function undo(room: Room): Result {
  if (room.phase === "lobby") return fail("Es läuft gerade kein Spiel.");
  const last = room.history.pop();
  if (!last) return fail("Es gibt nichts rückgängig zu machen.");
  room.cards[last.index].revealed = false;
  room.phase = last.phase;
  room.currentTeam = last.currentTeam;
  room.winner = last.winner;
  room.winReason = last.winReason;
  syncPause(room);
  return ok;
}

/** Zurück in die Lobby. Vorgeber und Team-Anpassungen bleiben erhalten. */
export function newRound(room: Room): Result {
  room.phase = "lobby";
  room.cards = [];
  // Startteam und aktives Team werden beim nächsten Start neu ausgelost.
  room.startingTeam = "a";
  room.currentTeam = "a";
  room.history = [];
  room.winner = undefined;
  room.winReason = undefined;
  return ok;
}

/** Gibt den Vorgeber-Slot eines Teams frei. Ein laufendes Spiel pausiert, bis der Slot neu belegt ist. */
export function releaseSlot(room: Room, team: TeamId): Result {
  if (!TEAM_IDS.includes(team)) return fail("Unbekanntes Team.");
  delete room.players[team];
  syncPause(room);
  return ok;
}

/** Belegt einen freien Slot. Ein pausiertes Spiel läuft weiter, sobald alle Slots belegt sind. */
export function claimSlot(room: Room, team: TeamId, token: string): Result {
  if (!TEAM_IDS.includes(team)) return fail("Unbekanntes Team.");
  if (room.players[team]) return fail("Für dieses Team ist schon ein Vorgeber verbunden.");
  room.players[team] = token;
  syncPause(room);
  return ok;
}

export function teamForToken(room: Room, token: string | undefined): TeamId | undefined {
  if (!token) return undefined;
  return TEAM_IDS.find((team) => room.players[team] === token);
}
