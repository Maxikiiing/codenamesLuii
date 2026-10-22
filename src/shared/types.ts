// Gemeinsame Typen für Server und Client. Die Teams heißen intern "a" und "b",
// weil Name und Farbe frei wählbar sind.

export type TeamId = "a" | "b";
export type CardType = TeamId | "neutral" | "assassin";
export type Phase = "lobby" | "playing" | "paused" | "finished";
export type WinReason = "allFound" | "assassin";

export const TEAM_IDS: readonly TeamId[] = ["a", "b"];

export const otherTeam = (team: TeamId): TeamId => (team === "a" ? "b" : "a");

export const PALETTE = ["red", "blue", "green", "purple", "orange", "pink", "teal", "yellow"] as const;
export type PaletteColor = (typeof PALETTE)[number];

export const MAX_TEAM_NAME_LENGTH = 20;

/** Eintrag von /api/wordlists. */
export interface WordListInfo {
  name: string;
  count: number;
  /** Mindestens 25 Wörter, also für eine Runde nutzbar. */
  usable: boolean;
}

export interface TeamConfig {
  name: string;
  color: PaletteColor;
}

/** Karte, wie sie öffentlich sichtbar ist: der Typ nur, wenn sie aufgedeckt ist. */
export interface PublicCard {
  word: string;
  revealed: boolean;
  type?: CardType;
}

/** Alles, was Screen und nicht authentifizierte Clients sehen dürfen. */
export interface PublicState {
  code: string;
  phase: Phase;
  teams: Record<TeamId, TeamConfig>;
  cards: PublicCard[];
  startingTeam: TeamId;
  currentTeam: TeamId;
  winner?: TeamId;
  winReason?: WinReason;
  remaining: Record<TeamId, number>;
  /** Slot belegt (Token vergeben). */
  slots: Record<TeamId, boolean>;
  /** Mindestens ein Gerät mit gültigem Token ist gerade verbunden. */
  connected: Record<TeamId, boolean>;
  /** Team, auf dessen neuen Vorgeber gewartet wird. */
  waitingFor?: TeamId;
  canUndo: boolean;
  wordList: string;
  wordLists: string[];
  joinUrl: string;
  /** Die Join-URL zeigt auf localhost und ist von Handys aus nicht erreichbar. */
  joinUrlIsLocal: boolean;
}

/** Zusätzlich für den Player: die geheime Karte und das eigene Team. */
export interface PlayerState extends PublicState {
  team: TeamId;
  key: CardType[];
}

export type Action =
  | { type: "updateTeam"; team: TeamId; name?: string; color?: PaletteColor }
  | { type: "setWordList"; wordList: string }
  | { type: "startGame" }
  | { type: "reveal"; index: number }
  | { type: "endTurn" }
  | { type: "newRound" }
  | { type: "undo" }
  | { type: "releaseSlot"; team: TeamId };

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Socket-Events (Client → Server). */
export interface ClientToServerEvents {
  createRoom: (cb: (res: Ack<{ code: string }>) => void) => void;
  joinScreen: (req: { code: string }, cb: (res: Ack) => void) => void;
  peekRoom: (req: { code: string }, cb: (res: Ack<{ state: PublicState }>) => void) => void;
  joinPlayer: (
    req: { code: string; team?: TeamId; token?: string },
    cb: (res: Ack<{ team: TeamId; token: string }>) => void,
  ) => void;
  action: (action: Action, cb: (res: Ack) => void) => void;
}

/** Socket-Events (Server → Client). */
export interface ServerToClientEvents {
  state: (state: PublicState | PlayerState) => void;
  /** Das Gerät wurde per „Neue Verbindung erlauben“ getrennt. */
  kicked: () => void;
}
