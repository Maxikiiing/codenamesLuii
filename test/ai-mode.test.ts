import { describe, expect, it } from "vitest";
import * as game from "../src/server/game.js";
import type { Room } from "../src/server/game.js";
import type { CardType } from "../src/shared/types.js";

const WORDS = Array.from({ length: 25 }, (_, i) => `WORT${i}`);

/** 9×a, 8×b, 7×neutral, 1×Attentäter; Team a beginnt. */
const FIXED: CardType[] = [
  ...Array<CardType>(9).fill("a"),
  ...Array<CardType>(8).fill("b"),
  ...Array<CardType>(7).fill("neutral"),
  "assassin",
];
const A = (n: number) => n;
const B = (n: number) => 9 + n;
const NEUTRAL = 17;

function lobby(): Room {
  const room = game.createRoom("TEST", "de-standard");
  game.claimSlot(room, "a", "token-a");
  game.claimSlot(room, "b", "token-b");
  return room;
}

function aiGame(words: string[] = WORDS): Room {
  const room = lobby();
  expect(game.setMode(room, "ai").ok).toBe(true);
  expect(game.startGame(room, words).ok).toBe(true);
  room.startingTeam = "a";
  room.currentTeam = "a";
  room.cards.forEach((card, i) => (card.type = FIXED[i]));
  return room;
}

describe("Moduswahl", () => {
  it("Standard ist Klassisch, gewählt wird nur in der Lobby", () => {
    const room = lobby();
    expect(room.mode).toBe("classic");
    expect(game.setMode(room, "quatsch").ok).toBe(false);
    expect(game.setMode(room, "ai").ok).toBe(true);
    game.startGame(room, WORDS);
    expect(game.setMode(room, "classic").ok).toBe(false);
    expect(room.mode).toBe("ai");
  });

  it("„Neue Runde“ behält den Modus und leert die Hinweise", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    expect(game.newRound(room).ok).toBe(true);
    expect(room.mode).toBe("ai");
    expect(room.clues).toEqual([]);
  });

  it("im Modus Klassisch gibt es keine Hinweise", () => {
    const room = lobby();
    game.startGame(room, WORDS);
    expect(game.giveClue(room, room.currentTeam, "Tier", 2).ok).toBe(false);
  });
});

describe("Hinweis-Validierung", () => {
  const board = ["PARADIES", "HAUSTÜR", "MÜHLE", "STRAẞE", ...WORDS.slice(4)];

  it.each([
    ["Tier", 2, true],
    ["See-Pferd", 1, true],
    ["", 1, false],
    ["zwei Wörter", 1, false],
    ["Rock'n'Roll", 1, true],
    ["!?", 1, false],
    ["a".repeat(31), 1, false],
    ["Tier", 0, false],
    ["Tier", 10, false],
    ["Tier", 1.5, false],
    ["Tier", "2", false],
  ])("„%s“ mit Zahl %s → gültig: %s", (word, number, valid) => {
    const room = aiGame(board);
    expect(game.giveClue(room, "a", word, number).ok).toBe(valid);
  });

  it("AK4: ein Hinweis, der einem verdeckten Feldwort gleicht, wird abgelehnt (normalisiert)", () => {
    const room = aiGame(board);
    for (const word of ["paradies", "Muehle", "MÜHLE", "strasse", "Haustuer"]) {
      const res = game.giveClue(room, "a", word, 1);
      expect(res.ok, word).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/zu nah/);
    }
  });

  it("AK4b: „Rad“ und „Tür“ sind gültig, „Haus“ wird abgelehnt", () => {
    expect(game.clueConflicts("Rad", "PARADIES")).toBe(false);
    expect(game.clueConflicts("Tür", "HAUSTÜR")).toBe(false);
    expect(game.clueConflicts("Haus", "HAUSTÜR")).toBe(true);
  });

  it("Wortteile ab 4 Zeichen nur am Anfang oder Ende, in beide Richtungen", () => {
    expect(game.clueConflicts("Haustürschlüssel", "HAUSTÜR")).toBe(true);
    expect(game.clueConflicts("Gartenhaus", "HAUS")).toBe(true);
    expect(game.clueConflicts("Rathausplatz", "HAUS")).toBe(false);
    // Länge vor der Normalisierung: „Öl“ hat 2 Zeichen, auch wenn „oel“ 3 hätte.
    expect(game.clueConflicts("Öl", "ÖLFASS")).toBe(false);
  });

  it("Wortteil-Regel gilt in beide Richtungen, auch wenn ß die Länge verändert", () => {
    expect(game.clueConflicts("Paßt", "PASS")).toBe(true);
    expect(game.clueConflicts("PASS", "Paßt")).toBe(true);
  });

  it("Bindestriche, Satzzeichen und NFD-Eingaben umgehen die Regeln nicht", () => {
    expect(game.clueConflicts("Haus-Tür", "HAUSTÜR")).toBe(true);
    expect(game.clueConflicts("Haus.", "HAUS")).toBe(true);
    const room = aiGame(board);
    const nfd = "Mu\u0308hle";
    const res = game.giveClue(room, "a", nfd, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zu nah/);
    expect(game.giveClue(room, "a", "Tu\u0308r", 1).ok).toBe(true);
    expect(game.activeClue(room)?.word).toBe("TÜR");
  });

  it("aufgedeckte Feldwörter sind als Hinweis erlaubt", () => {
    const room = aiGame(board);
    room.cards[0].revealed = true;
    expect(game.giveClue(room, "a", "Paradies", 1).ok).toBe(true);
  });

  it("speichert den Hinweis in Großbuchstaben", () => {
    const room = aiGame();
    game.giveClue(room, "a", "  Straße ", 3);
    expect(game.activeClue(room)).toEqual({ team: "a", word: "STRAẞE", number: 3, guesses: [] });
  });
});

describe("Zug mit Hinweis", () => {
  it("nur das aktive Team, nur ein Hinweis pro Zug", () => {
    const room = aiGame();
    expect(game.giveClue(room, "b", "Tier", 1).ok).toBe(false);
    expect(game.giveClue(room, "a", "Tier", 1).ok).toBe(true);
    expect(game.giveClue(room, "a", "Pflanze", 1).ok).toBe(false);
  });

  it("ohne Hinweis kann nicht aufgedeckt und kein Zug beendet werden", () => {
    const room = aiGame();
    expect(game.reveal(room, "a", A(0)).ok).toBe(false);
    expect(game.endTurn(room, "a").ok).toBe(false);
  });

  it("AK5: Zahl 2, drei eigene Karten → Zug endet nach dem dritten Versuch", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    game.reveal(room, "a", A(0));
    game.reveal(room, "a", A(1));
    expect(room.currentTeam).toBe("a");
    game.reveal(room, "a", A(2));
    expect(room.currentTeam).toBe("b");
    expect(room.clues[0].stopped).toBe("limit");
    expect(room.clues[0].guesses.map((g) => g.type)).toEqual(["a", "a", "a"]);
    expect(game.activeClue(room)).toBeUndefined();
  });

  it("eine falsche Karte beendet den Zug und wird als Ergebnis gespeichert", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    game.reveal(room, "a", A(0));
    game.reveal(room, "a", NEUTRAL);
    expect(room.currentTeam).toBe("b");
    expect(room.clues[0]).toMatchObject({ stopped: "wrong", guesses: [{ type: "a" }, { type: "neutral" }] });
  });

  it("„Zug beenden“ beendet den Hinweis freiwillig, danach braucht das andere Team einen eigenen", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    game.reveal(room, "a", A(0));
    expect(game.endTurn(room, "a").ok).toBe(true);
    expect(room.clues[0].stopped).toBe("choice");
    expect(game.reveal(room, "b", B(0)).ok).toBe(false);
    expect(game.giveClue(room, "b", "Pflanze", 1).ok).toBe(true);
    expect(room.clues).toHaveLength(2);
  });

  it("AK12: solange die KI rät, lehnt der Server Aufdecken und Zugende ab", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    room.aiThinking = true;
    expect(game.reveal(room, "a", A(0)).ok).toBe(false);
    expect(game.endTurn(room, "a").ok).toBe(false);
  });

  it("AK12b: Undo ist im KI-Modus gesperrt, auch wenn die KI nicht rät", () => {
    const room = aiGame();
    game.giveClue(room, "a", "Tier", 2);
    game.reveal(room, "a", A(0));
    const res = game.undo(room);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Im KI-Modus nicht verfügbar.");
    expect(room.cards[A(0)].revealed).toBe(true);
  });
});
