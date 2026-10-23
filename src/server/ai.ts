// KI-Rater (Spec 002): baut den Prompt ausschließlich aus öffentlicher Information,
// fragt das Modell Schritt für Schritt und deckt die gewählten Karten auf.

import { otherTeam, type CardType, type Clue, type PublicState, type TeamId } from "../shared/types.js";
import * as game from "./game.js";
import type { Room } from "./game.js";
import type { ChatClient, ChatMessage } from "./ollama.js";

export const STEP_TIMEOUT_MS = 45_000;
export const MSG_CLUELESS = "Die KI ist ratlos und gibt den Zug ab.";
export const MSG_TIMEOUT = "Die KI hat zu lange überlegt und gibt den Zug ab.";
export const MSG_UNREACHABLE = "Ollama ist nicht erreichbar, der Zug ist beendet.";

/** Lesepause vor dem Aufdecken: 50 ms pro Zeichen, mindestens 2 s, höchstens 10 s. */
export function readingPause(thought: string): number {
  return Math.min(10_000, Math.max(2_000, thought.length * 50));
}

/** Öffentliche Sicht, aus der der Prompt entsteht. Bewusst ohne `key`. */
export type PromptState = Pick<PublicState, "cards" | "teams">;

function typeLabel(type: CardType | undefined, team: TeamId): string {
  if (type === team) return "euer Team";
  if (type === otherTeam(team)) return "Gegner";
  if (type === "neutral") return "neutral";
  if (type === "assassin") return "Attentäter";
  return "unbekannt";
}

function guessList(clue: Clue, team: TeamId): string {
  return clue.guesses.length
    ? clue.guesses.map((g) => `${g.word} (${typeLabel(g.type, team)})`).join(", ")
    : "nichts aufgedeckt";
}

const SYSTEM_PROMPT = `Du bist Rater in einer Runde Codenames und spielst wie ein menschlicher Mitspieler.
Dein Vorgeber hat dir einen Hinweis aus einem Wort und einer Zahl gegeben. Die Zahl sagt, wie viele verdeckte Wörter auf dem Feld zum Hinweis passen. Welche Karte zu welchem Team gehört, weißt du nicht.

Regeln:
- Deckst du eine Karte deines Teams auf, darfst du weiterraten.
- Eine neutrale Karte oder eine Karte des Gegners beendet deinen Zug, die Gegnerkarte hilft dem Gegner sogar.
- Deckst du den Attentäter auf, verliert dein Team sofort.
- Zum aktuellen Hinweis gehören genau so viele Wörter, wie die Zahl sagt, nie mehr. Hast du so viele gefunden, gibt es dazu nichts mehr zu raten.
- Einen einzigen Zusatzversuch gibt es nur, um ein noch offenes Wort aus einem früheren Hinweis deines Teams nachzuholen. Diese offenen Hinweise stehen im Prompt. Denk dabei an das frühere Hinweiswort, nicht an das aktuelle.
- Du darfst jederzeit aufhören, auch vor dem ersten Versuch.

So spielst du:
- Denk laut auf Deutsch in 1 bis 3 kurzen Sätzen, sprich die Mitspieler mit „du“ bzw. „ihr“ an. Wäge Kandidaten ab und sag offen, wenn du unsicher bist.
- Geh kein unnötiges Risiko ein. Wenn kein Wort mehr gut passt, hör lieber auf.
- Wähle nur Wörter, die noch verdeckt auf dem Feld liegen, und schreib sie genau so wie auf dem Feld.

Antworte ausschließlich mit JSON in dieser Form:
{"thought": "dein lauter Gedanke", "guess": "WORT"}
oder, wenn du aufhörst:
{"thought": "warum du aufhörst", "guess": null}`;

/** Eigene Treffer zu einem Hinweis. */
function ownFound(clue: Clue): number {
  return clue.guesses.filter((g) => g.type === clue.team).length;
}

/**
 * Frühere Hinweise von `team` (ohne `current`), zu denen noch Wörter fehlen. Eigene Treffer über
 * die Zahl eines späteren Hinweises hinaus gelten als nachgeholt und füllen die ältesten Lücken.
 */
export function openEarlierClues(
  clues: readonly Clue[],
  team: TeamId,
  current: Clue | undefined,
): { clue: Clue; missing: number }[] {
  // Der Reihe nach: Überschuss eines Hinweises füllt nur Lücken früherer Hinweise (Spec 002, R2).
  const open: { clue: Clue; missing: number }[] = [];
  for (const clue of clues.filter((c) => c.team === team)) {
    let surplus = Math.max(0, ownFound(clue) - clue.number);
    for (const entry of open) {
      const filled = Math.min(entry.missing, surplus);
      entry.missing -= filled;
      surplus -= filled;
    }
    if (clue !== current) open.push({ clue, missing: Math.max(0, clue.number - ownFound(clue)) });
  }
  return open.filter((entry) => entry.missing > 0);
}

/**
 * Baut den Prompt für einen KI-Schritt. Reine Funktion: nutzt nur öffentlich sichtbare Karten
 * und die Hinweise der Runde, der letzte Hinweis von `team` ist der aktuelle.
 */
export function buildPrompt(state: PromptState, clues: readonly Clue[], team: TeamId): ChatMessage[] {
  const hidden = state.cards.filter((c) => !c.revealed).map((c) => c.word);
  const revealed = state.cards.filter((c) => c.revealed).map((c) => `${c.word} (${typeLabel(c.type, team)})`);
  const current = clues.at(-1);
  const earlier = clues.slice(0, -1);

  const lines = [
    `Dein Team: ${state.teams[team].name}. Gegner: ${state.teams[otherTeam(team)].name}.`,
    "",
    `Verdeckte Wörter: ${hidden.join(", ")}`,
    `Schon aufgedeckt: ${revealed.length ? revealed.join(", ") : "noch nichts"}`,
  ];

  if (earlier.length) {
    lines.push("", "Bisherige Hinweise dieser Runde:");
    for (const clue of earlier) {
      const who = clue.team === team ? "Dein Team" : "Gegner";
      lines.push(`- ${who}: „${clue.word}“ ${clue.number} → ${guessList(clue, team)}`);
    }
  }

  const open = openEarlierClues(clues, team, current?.team === team ? current : undefined);
  if (open.length) {
    lines.push(
      "",
      "Noch offene Wörter aus früheren Hinweisen deines Teams:",
      ...open.map(({ clue, missing }) => `- „${clue.word}“: noch ${missing} ${missing === 1 ? "Wort" : "Wörter"} nicht gefunden`),
    );
  }

  if (current && current.team === team) {
    const found = ownFound(current);
    lines.push("", `Aktueller Hinweis: „${current.word}“ ${current.number}`, `In diesem Zug bisher: ${guessList(current, team)}.`);
    if (found < current.number) {
      const words = current.number === 1 ? "1 Wort" : `${current.number} Wörter`;
      lines.push(`Zu „${current.word}“ gehören genau ${words}, ${found} davon hast du gefunden.`);
    } else {
      lines.push(
        `Alle ${current.number} Wörter zu „${current.word}“ sind gefunden. Rate nichts mehr zu „${current.word}“.`,
        "Du kannst einen Zusatzversuch für ein offenes Wort aus einem früheren Hinweis nutzen, wenn du dir sicher bist, sonst hör auf.",
      );
    }
  }

  lines.push("", "Welches Wort deckst du als Nächstes auf, oder hörst du auf?");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

export type ParsedAnswer =
  | { ok: true; thought: string; index: number | null }
  | { ok: false; error: string };

/** Liest die Antwort des Modells und ordnet `guess` normalisiert einem verdeckten Feldwort zu. */
export function parseAnswer(content: string, cards: PromptState["cards"]): ParsedAnswer {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { ok: false, error: "Die Antwort war kein gültiges JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "Die Antwort war kein JSON-Objekt." };
  const { thought, guess } = data as { thought?: unknown; guess?: unknown };
  if (typeof thought !== "string" || !thought.trim()) return { ok: false, error: "Es fehlt der Gedanke (`thought`)." };
  if (guess === null || guess === undefined || (typeof guess === "string" && !guess.trim())) {
    return { ok: true, thought: thought.trim(), index: null };
  }
  if (typeof guess !== "string") return { ok: false, error: "`guess` muss ein Wort oder null sein." };
  const wanted = game.normalizeForCompare(guess);
  const index = cards.findIndex((c) => !c.revealed && game.normalizeForCompare(c.word) === wanted);
  if (index < 0) return { ok: false, error: `„${guess}“ liegt nicht verdeckt auf dem Feld.` };
  return { ok: true, thought: thought.trim(), index };
}

export interface AiDeps {
  client: ChatClient;
  /** Liefert den aktuellen öffentlichen State des Raums. */
  publicState: () => PromptState;
  /** Verteilt den geänderten State an alle Geräte. */
  broadcast: () => Promise<void>;
  stepTimeoutMs?: number;
  /** Wartezeit zwischen Gedanke und Aufdeckung, in Tests verkürzt. */
  pause?: (thought: string) => number;
}

/** Wartet `ms`, bricht bei `signal` vorzeitig ab. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** Bricht auch dann ab, wenn der Client das Signal ignoriert. */
function withAbort<T>(promise: Promise<T>, any: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(any.reason);
    if (any.aborted) return onAbort();
    any.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => any.removeEventListener("abort", onAbort));
  });
}

type StepResult = { ok: true; thought: string; index: number | null } | { ok: false; message: string };

/** Ein Schritt: höchstens zwei Anfragen, die zweite nur bei unbrauchbarer Antwort. */
async function askModel(deps: AiDeps, room: Room, clue: Clue, signal: AbortSignal): Promise<StepResult> {
  const state = deps.publicState();
  const messages = buildPrompt(state, room.clues, clue.team);
  // Ein Zeitlimit für den ganzen Schritt, auch wenn neu nachgefragt wird.
  const timeout = AbortSignal.timeout(deps.stepTimeoutMs ?? STEP_TIMEOUT_MS);
  const stop = AbortSignal.any([signal, timeout]);
  for (let attempt = 0; attempt < 2; attempt++) {
    let content: string;
    try {
      content = await withAbort(deps.client.chat(messages, stop), stop);
    } catch (e) {
      if (!signal.aborted && !timeout.aborted) console.error("KI-Anfrage fehlgeschlagen:", e);
      return { ok: false, message: timeout.aborted ? MSG_TIMEOUT : MSG_UNREACHABLE };
    }
    const answer = parseAnswer(content, state.cards);
    if (answer.ok) return answer;
    messages.push(
      { role: "assistant", content },
      { role: "user", content: `${answer.error} Antworte noch einmal, nur mit dem JSON-Objekt.` },
    );
  }
  return { ok: false, message: MSG_CLUELESS };
}

/**
 * Spielt den KI-Zug zum aktiven Hinweis von `room`, bis die KI aufhört, falsch rät, das
 * Versuchslimit erreicht ist oder `signal` auslöst (Pause, neue Runde). Ein abgebrochener
 * Schritt ändert nichts am Spielstand.
 */
export async function runAiTurn(room: Room, deps: AiDeps, signal: AbortSignal): Promise<void> {
  const clue = game.activeClue(room);
  if (!clue) return;
  const stillCurrent = () => !signal.aborted && room.phase === "playing" && game.activeClue(room) === clue;

  room.aiThinking = true;
  room.aiThoughtTeam = clue.team;
  await deps.broadcast();
  try {
    while (stillCurrent()) {
      // Alles zum Hinweis gefunden und nichts von früher offen: kein Zusatzversuch ins Blaue.
      if (ownFound(clue) >= clue.number && openEarlierClues(room.clues, clue.team, clue).length === 0) {
        room.aiThought = `Alle ${clue.number} Wörter zu „${clue.word}“ gefunden, ich höre auf.`;
        game.endAiTurn(room, "choice");
        return;
      }
      const step = await askModel(deps, room, clue, signal);
      if (!stillCurrent()) return;
      if (!step.ok) {
        room.aiThought = step.message;
        game.endAiTurn(room, "error");
        return;
      }
      room.aiThought = step.thought;
      if (step.index === null) {
        game.endAiTurn(room, "choice");
        return;
      }
      await deps.broadcast();
      await sleep((deps.pause ?? readingPause)(step.thought), signal);
      if (!stillCurrent()) return;
      if (!game.aiReveal(room, step.index).ok) {
        room.aiThought = MSG_CLUELESS;
        game.endAiTurn(room, "error");
        return;
      }
      if (game.activeClue(room) === clue) await deps.broadcast();
    }
  } finally {
    // Nach einem Abbruch setzt der Auslöser den Zustand zurück (Pause, „Neue Runde“).
    if (!signal.aborted) room.aiThinking = false;
  }
}
