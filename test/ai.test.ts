import { describe, expect, it } from "vitest";
import { buildPrompt, parseAnswer, readingPause, type PromptState } from "../src/server/ai.js";
import * as game from "../src/server/game.js";
import { RoomManager } from "../src/server/rooms.js";
import type { CardType, Clue } from "../src/shared/types.js";

const WORDS = ["MÜHLE", "HUND", "KATZE", "BANK", "MOND", ...Array.from({ length: 20 }, (_, i) => `WORT${i}`)];

/** Öffentlicher State eines Raums mit der angegebenen geheimen Verteilung. */
function publicStateWith(types: CardType[], revealed: number[] = []): PromptState {
  const manager = new RoomManager();
  const entry = manager.create("http://localhost", "de-standard");
  const { room } = entry;
  game.claimSlot(room, "a", "ta");
  game.claimSlot(room, "b", "tb");
  game.startGame(room, WORDS);
  room.cards.forEach((card, i) => {
    card.type = types[i];
    card.revealed = revealed.includes(i);
  });
  return manager.publicState(entry, []);
}

const TYPES: CardType[] = [
  "a", "a", "b", "neutral", "assassin",
  ...Array<CardType>(7).fill("a"), ...Array<CardType>(7).fill("b"), ...Array<CardType>(6).fill("neutral"),
];
const prompt = (state: PromptState, clues: Clue[]) => buildPrompt(state, clues, "a").map((m) => m.content).join("\n");

describe("buildPrompt", () => {
  it("AK8: verdeckte Karten verraten ihren Typ nicht", () => {
    // Gleiche öffentliche Lage, völlig andere geheime Verteilung → identischer Prompt.
    const shuffled = [...TYPES].reverse();
    const clue: Clue = { team: "a", word: "TIER", number: 2, guesses: [] };
    expect(prompt(publicStateWith(TYPES), [clue])).toBe(prompt(publicStateWith(shuffled), [clue]));
    const text = buildPrompt(publicStateWith(TYPES), [clue], "a")[1].content;
    expect(text).toContain("Verdeckte Wörter: MÜHLE, HUND, KATZE, BANK, MOND");
    expect(text).not.toMatch(/\((euer Team|Gegner|neutral|Attentäter)\)/);
  });

  it("aufgedeckte Karten erscheinen mit ihrem Typ aus Sicht des Teams", () => {
    const text = prompt(publicStateWith(TYPES, [0, 2, 3, 4]), []);
    expect(text).toContain("MÜHLE (euer Team), KATZE (Gegner), BANK (neutral), MOND (Attentäter)");
    expect(text).not.toMatch(/Verdeckte Wörter:.*MÜHLE/);
  });

  it("AK9: frühere Hinweise samt Ergebnis stehen im Prompt, offene eigene Wörter werden genannt", () => {
    const clues: Clue[] = [
      { team: "a", word: "TIER", number: 2, guesses: [{ word: "HUND", type: "a" }, { word: "BANK", type: "neutral" }], stopped: "wrong" },
      { team: "b", word: "NACHT", number: 1, guesses: [{ word: "KATZE", type: "b" }], stopped: "choice" },
      { team: "a", word: "MÜLLER", number: 1, guesses: [] },
    ];
    const text = prompt(publicStateWith(TYPES, [1, 2, 3]), clues);
    expect(text).toContain("- Dein Team: „TIER“ 2 → HUND (euer Team), BANK (neutral), noch 1 offen");
    expect(text).toContain("- Gegner: „NACHT“ 1 → KATZE (Gegner)");
    expect(text).toContain("Aktueller Hinweis: „MÜLLER“ 1");
    expect(text).toContain("Du hast noch 2 Versuche.");
  });

  it("zählt die Versuche im laufenden Zug herunter", () => {
    const clues: Clue[] = [{ team: "a", word: "TIER", number: 2, guesses: [{ word: "HUND", type: "a" }, { word: "MÜHLE", type: "a" }] }];
    expect(prompt(publicStateWith(TYPES, [0, 1]), clues)).toContain("In diesem Zug bisher: HUND (euer Team), MÜHLE (euer Team). Du hast noch 1 Versuch.");
  });
});

describe("parseAnswer", () => {
  const cards = publicStateWith(TYPES, [1]).cards;

  it("AK10b: „muehle“ wird „MÜHLE“ zugeordnet", () => {
    expect(parseAnswer('{"thought": "Mühle passt.", "guess": "muehle"}', cards)).toEqual({ ok: true, thought: "Mühle passt.", index: 0 });
  });

  it("`guess: null` (oder leer) heißt aufhören", () => {
    expect(parseAnswer('{"thought": "Ich bin unsicher.", "guess": null}', cards)).toMatchObject({ ok: true, index: null });
    expect(parseAnswer('{"thought": "Ich bin unsicher.", "guess": ""}', cards)).toMatchObject({ ok: true, index: null });
  });

  it.each([
    ["kein json", /kein gültiges JSON/],
    ['["HUND"]', /Gedanke/],
    ['{"guess": "KATZE"}', /Gedanke/],
    ['{"thought": "x", "guess": 3}', /Wort oder null/],
    ['{"thought": "x", "guess": "HUND"}', /nicht verdeckt/], // schon aufgedeckt
    ['{"thought": "x", "guess": "ELEFANT"}', /nicht verdeckt/],
  ])("lehnt %s ab", (content, error) => {
    const res = parseAnswer(content, cards);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(error);
  });
});

describe("Lesepause", () => {
  it("50 ms pro Zeichen, mindestens 2 s, höchstens 10 s", () => {
    expect(readingPause("kurz")).toBe(2000);
    expect(readingPause("x".repeat(100))).toBe(5000);
    expect(readingPause("x".repeat(500))).toBe(10000);
  });
});
