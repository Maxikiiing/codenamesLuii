// Reine Spiellogik ohne Netzwerk. Jede Funktion verändert den übergebenen Raum
// und liefert bei ungültigen Aktionen einen Fehler, ohne etwas zu ändern.

import {
  GAME_MODES,
  MAX_CLUE_LENGTH,
  MAX_CLUE_NUMBER,
  MAX_TEAM_NAME_LENGTH,
  MIN_CLUE_NUMBER,
  otherTeam,
  PALETTE,
  TEAM_IDS,
  type CardType,
  type Clue,
  type ClueStop,
  type GameMode,
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
  mode: GameMode;
  /** Alle Hinweise der laufenden Runde (KI-Modus), Gedächtnis der KI. */
  clues: Clue[];
  aiThinking: boolean;
  aiThought?: string;
}

const ok: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });

export { otherTeam };

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
    mode: "classic",
    clues: [],
    aiThinking: false,
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

export function setMode(room: Room, mode: unknown): Result {
  if (room.phase !== "lobby") return fail("Der Modus kann nur in der Lobby gewählt werden.");
  if (!GAME_MODES.includes(mode as GameMode)) return fail("Unbekannter Modus.");
  room.mode = mode as GameMode;
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
  resetClues(room);
  room.phase = "playing";
  return ok;
}

function resetClues(room: Room): void {
  room.clues = [];
  room.aiThinking = false;
  room.aiThought = undefined;
}

/** Hinweis, zu dem das aktive Team gerade rät, oder undefined. */
export function activeClue(room: Room): Clue | undefined {
  if (room.phase !== "playing" && room.phase !== "paused") return undefined;
  const last = room.clues.at(-1);
  return last && !last.stopped && last.team === room.currentTeam ? last : undefined;
}

/** Nur Buchstaben und Ziffern (NFC), damit Bindestriche oder Satzzeichen die Regeln nicht umgehen. */
function lettersOnly(word: string): string {
  return word.normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
}

/** Vergleichsform: nur Buchstaben und Ziffern, kleingeschrieben, Umlaute und ß ausgeschrieben. */
export function normalizeForCompare(word: string): string {
  return lettersOnly(word)
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** Kürzere Wortteile dürfen im Hinweis vorkommen (Spec 002, R2). */
const MIN_PART_LENGTH = 4;

/** Steht `part` (ab 4 Zeichen vor der Normalisierung) am Anfang oder Ende von `whole`? */
function isEdgePart(part: string, whole: string): boolean {
  if ([...lettersOnly(part)].length < MIN_PART_LENGTH) return false;
  const p = normalizeForCompare(part);
  const w = normalizeForCompare(whole);
  return w.startsWith(p) || w.endsWith(p);
}

/**
 * Prüft, ob ein Hinweis gegen ein verdecktes Feldwort verstößt: gleich, oder eines der
 * beiden Wörter (ab 4 Zeichen) steht am Anfang oder Ende des anderen.
 */
export function clueConflicts(clue: string, boardWord: string): boolean {
  if (normalizeForCompare(clue) === normalizeForCompare(boardWord)) return true;
  return isEdgePart(clue, boardWord) || isEdgePart(boardWord, clue);
}

/** Validiert einen Hinweis gegen die verdeckten Wörter. Liefert das bereinigte Wort. */
export function validateClue(
  room: Room,
  word: unknown,
  number: unknown,
): { ok: true; word: string; number: number } | { ok: false; error: string } {
  if (typeof word !== "string") return { ok: false, error: "Bitte ein Hinweiswort eingeben." };
  const trimmed = word.normalize("NFC").trim();
  if (!trimmed) return { ok: false, error: "Bitte ein Hinweiswort eingeben." };
  if (/\s/.test(trimmed)) return { ok: false, error: "Der Hinweis muss genau ein Wort sein." };
  if ([...trimmed].length > MAX_CLUE_LENGTH) {
    return { ok: false, error: `Der Hinweis darf höchstens ${MAX_CLUE_LENGTH} Zeichen haben.` };
  }
  if (!lettersOnly(trimmed)) return { ok: false, error: "Der Hinweis braucht mindestens einen Buchstaben." };
  if (!Number.isInteger(number) || (number as number) < MIN_CLUE_NUMBER || (number as number) > MAX_CLUE_NUMBER) {
    return { ok: false, error: `Die Zahl muss zwischen ${MIN_CLUE_NUMBER} und ${MAX_CLUE_NUMBER} liegen.` };
  }
  const conflict = room.cards.find((card) => !card.revealed && clueConflicts(trimmed, card.word));
  if (conflict) {
    return { ok: false, error: `„${trimmed}“ ist zu nah an „${conflict.word}“ auf dem Feld.` };
  }
  return { ok: true, word: trimmed.replace(/ß/g, "ẞ").toLocaleUpperCase("de-DE"), number: number as number };
}

/** Gibt im KI-Modus einen Hinweis für das aktive Team ab. */
export function giveClue(room: Room, team: TeamId, word: unknown, number: unknown): Result {
  if (room.mode !== "ai") return fail("Hinweise werden nur im KI-Modus eingegeben.");
  const turn = checkTurn(room, team);
  if (!turn.ok) return turn;
  if (activeClue(room)) return fail("Für diesen Zug gibt es schon einen Hinweis.");
  const valid = validateClue(room, word, number);
  if (!valid.ok) return valid;
  room.clues.push({ team, word: valid.word, number: valid.number, guesses: [] });
  room.aiThought = undefined;
  return ok;
}

function stopClue(room: Room, reason: ClueStop): void {
  const clue = activeClue(room);
  if (clue) clue.stopped = reason;
}

/** Prüft, ob `team` gerade am Zug handeln darf. */
function checkTurn(room: Room, team: TeamId): Result {
  if (room.phase === "paused") return fail("Das Spiel ist pausiert, bis ein neuer Vorgeber beigetreten ist.");
  if (room.phase !== "playing") return fail("Es läuft gerade kein Spiel.");
  if (room.currentTeam !== team) return fail("Dein Team ist nicht am Zug.");
  if (room.aiThinking) return fail("Die KI rät gerade.");
  return ok;
}

export function reveal(room: Room, team: TeamId, index: number): Result {
  const turn = checkTurn(room, team);
  if (!turn.ok) return turn;
  if (!Number.isInteger(index) || index < 0 || index >= room.cards.length) return fail("Unbekannte Karte.");
  const card = room.cards[index];
  if (card.revealed) return fail("Diese Karte ist schon aufgedeckt.");
  const clue = activeClue(room);
  if (room.mode === "ai" && !clue) return fail("Zuerst einen Hinweis abgeben.");

  room.history.push({
    index,
    phase: room.phase,
    currentTeam: room.currentTeam,
    winner: room.winner,
    winReason: room.winReason,
  });
  card.revealed = true;
  if (clue) {
    clue.guesses.push({ word: card.word, type: card.type });
    // Spielende oder falsche Karte beenden den Zug, sonst nach Zahl + 1 Versuchen.
    if (card.type !== team) clue.stopped = "wrong";
    else if (clue.guesses.length >= clue.number + 1) clue.stopped = "limit";
  }

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
    if (clue && !clue.stopped) clue.stopped = "limit";
    return ok;
  }

  if (card.type !== team || clue?.stopped === "limit") room.currentTeam = otherTeam(team);
  return ok;
}

export function endTurn(room: Room, team: TeamId): Result {
  const turn = checkTurn(room, team);
  if (!turn.ok) return turn;
  if (room.mode === "ai" && !activeClue(room)) return fail("Zuerst einen Hinweis abgeben.");
  stopClue(room, "choice");
  room.currentTeam = otherTeam(team);
  return ok;
}

/** Macht die letzte Aufdeckung rückgängig, inklusive Zugwechsel oder Spielende. */
export function undo(room: Room): Result {
  if (room.phase === "lobby") return fail("Es läuft gerade kein Spiel.");
  if (room.mode === "ai") return fail("Im KI-Modus nicht verfügbar.");
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
  // Der Modus bleibt erhalten, das Gedächtnis der KI nicht.
  resetClues(room);
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
