import { describe, expect, it } from "vitest";
import * as game from "../src/server/game.js";
import type { Room } from "../src/server/game.js";
import type { CardType, TeamId } from "../src/shared/types.js";

const WORDS = Array.from({ length: 25 }, (_, i) => `WORT${i}`);

/** Deterministischer Zufall für reproduzierbare Tests. */
function seeded(seed: number): game.Random {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function lobby(): Room {
  const room = game.createRoom("TEST", "de-standard");
  game.claimSlot(room, "a", "token-a");
  game.claimSlot(room, "b", "token-b");
  return room;
}

/** Laufendes Spiel mit fester Verteilung, Team a beginnt. */
function playing(types?: CardType[]): Room {
  const room = lobby();
  expect(game.startGame(room, WORDS, seeded(1)).ok).toBe(true);
  room.startingTeam = "a";
  room.currentTeam = "a";
  if (types) room.cards.forEach((card, i) => (card.type = types[i]));
  return room;
}

/** 9×a, 8×b, 7×neutral, 1×Attentäter in fester Reihenfolge. */
const FIXED: CardType[] = [
  ...Array<CardType>(9).fill("a"),
  ...Array<CardType>(8).fill("b"),
  ...Array<CardType>(7).fill("neutral"),
  "assassin",
];
const A = (n: number) => n; // Karten 0–8 gehören Team a
const B = (n: number) => 9 + n; // Karten 9–16 gehören Team b
const NEUTRAL = 17;
const ASSASSIN = 24;

const snapshot = (room: Room) => JSON.parse(JSON.stringify(room));
const count = (room: Room, type: CardType) => room.cards.filter((c) => c.type === type).length;

describe("Kartenverteilung", () => {
  it.each(["a", "b"] as TeamId[])("Startteam %s bekommt 9, das andere 8, dazu 7 neutral und 1 Attentäter", (start) => {
    const cards = game.dealCards(WORDS, start, seeded(42));
    const room = { cards } as Room;
    expect(cards).toHaveLength(25);
    expect(count(room, start)).toBe(9);
    expect(count(room, game.otherTeam(start))).toBe(8);
    expect(count(room, "neutral")).toBe(7);
    expect(count(room, "assassin")).toBe(1);
    expect(cards.map((c) => c.word)).toEqual(WORDS);
    expect(cards.every((c) => !c.revealed)).toBe(true);
  });

  it("verteilt zufällig", () => {
    const a = game.dealCards(WORDS, "a", seeded(1)).map((c) => c.type);
    const b = game.dealCards(WORDS, "a", seeded(2)).map((c) => c.type);
    expect(a).not.toEqual(b);
  });

  it("bestimmt das Startteam zufällig und passend zur Verteilung", () => {
    const starters = new Set<TeamId>();
    for (let seed = 1; seed <= 20; seed++) {
      const room = lobby();
      game.startGame(room, WORDS, seeded(seed));
      starters.add(room.startingTeam);
      expect(room.currentTeam).toBe(room.startingTeam);
      expect(count(room, room.startingTeam)).toBe(9);
    }
    expect(starters).toEqual(new Set(["a", "b"]));
  });

  it("verlangt genau 25 Wörter", () => {
    expect(() => game.dealCards(WORDS.slice(1), "a")).toThrow();
  });
});

describe("Lobby", () => {
  it("startet nur mit zwei Vorgebern", () => {
    const room = game.createRoom("TEST", "x");
    game.claimSlot(room, "a", "t");
    expect(game.startGame(room, WORDS).ok).toBe(false);
    expect(room.phase).toBe("lobby");
  });

  it("lehnt einen zweiten Vorgeber für dasselbe Team ab", () => {
    const room = lobby();
    expect(game.claimSlot(room, "a", "neu").ok).toBe(false);
    expect(room.players.a).toBe("token-a");
  });

  it("ändert Name und Farbe, verbietet gleiche Farben und zu lange Namen", () => {
    const room = lobby();
    expect(game.updateTeam(room, "a", { name: "  Die  Füchse ", color: "green" }).ok).toBe(true);
    expect(room.teams.a).toEqual({ name: "Die Füchse", color: "green" });
    expect(game.updateTeam(room, "b", { color: "green" }).ok).toBe(false);
    expect(game.updateTeam(room, "b", { name: "x".repeat(21) }).ok).toBe(false);
    expect(game.updateTeam(room, "b", { name: "x".repeat(20) }).ok).toBe(true);
    expect(game.updateTeam(room, "b", { name: "   " }).ok).toBe(false);
    expect(game.updateTeam(room, "b", { color: "black" }).ok).toBe(false);
    expect(room.teams.b.color).toBe("blue");
  });

  it("erlaubt Team-Anpassungen nur in der Lobby", () => {
    const room = playing(FIXED);
    expect(game.updateTeam(room, "a", { name: "Neu" }).ok).toBe(false);
  });
});

describe("Zugablauf", () => {
  it("eigene Farbe: Team darf weiter raten", () => {
    const room = playing(FIXED);
    expect(game.reveal(room, "a", A(0)).ok).toBe(true);
    expect(room.cards[A(0)].revealed).toBe(true);
    expect(room.currentTeam).toBe("a");
  });

  it("neutral beendet den Zug", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", NEUTRAL);
    expect(room.currentTeam).toBe("b");
    expect(room.phase).toBe("playing");
  });

  it("Gegnerfarbe beendet den Zug", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", B(0));
    expect(room.currentTeam).toBe("b");
  });

  it("nur das aktive Team darf aufdecken oder den Zug beenden", () => {
    const room = playing(FIXED);
    expect(game.reveal(room, "b", A(0)).ok).toBe(false);
    expect(game.endTurn(room, "b").ok).toBe(false);
    expect(room.cards[A(0)].revealed).toBe(false);
    expect(game.endTurn(room, "a").ok).toBe(true);
    expect(room.currentTeam).toBe("b");
  });

  it("aufgedeckte und unbekannte Karten werden abgelehnt", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    expect(game.reveal(room, "a", A(0)).ok).toBe(false);
    expect(game.reveal(room, "a", 25).ok).toBe(false);
    expect(game.reveal(room, "a", -1).ok).toBe(false);
    expect(game.reveal(room, "a", 1.5).ok).toBe(false);
    expect(room.history).toHaveLength(1);
  });

  it("die Anzahl der Rateversuche ist nicht begrenzt", () => {
    const room = playing(FIXED);
    for (let i = 0; i < 8; i++) expect(game.reveal(room, "a", A(i)).ok).toBe(true);
    expect(room.currentTeam).toBe("a");
  });
});

describe("Spielende", () => {
  it("Attentäter: das aufdeckende Team verliert sofort", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", ASSASSIN);
    expect(room.phase).toBe("finished");
    expect(room.winner).toBe("b");
    expect(room.winReason).toBe("assassin");
  });

  it("alle eigenen Karten gefunden: Sieg", () => {
    const room = playing(FIXED);
    for (let i = 0; i < 9; i++) game.reveal(room, "a", A(i));
    expect(room.phase).toBe("finished");
    expect(room.winner).toBe("a");
    expect(room.winReason).toBe("allFound");
  });

  it("Sieg auch, wenn das gegnerische Team die letzte Karte aufdeckt", () => {
    const room = playing(FIXED);
    game.endTurn(room, "a");
    for (let i = 0; i < 7; i++) {
      game.reveal(room, "b", B(i));
      expect(room.currentTeam).toBe("b");
    }
    game.reveal(room, "b", NEUTRAL); // b → a
    game.reveal(room, "a", B(7)); // a deckt die letzte Karte von b auf
    expect(room.phase).toBe("finished");
    expect(room.winner).toBe("b");
    expect(room.winReason).toBe("allFound");
  });

  it("nach Spielende sind keine Züge mehr möglich", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", ASSASSIN);
    expect(game.reveal(room, "b", A(0)).ok).toBe(false);
    expect(game.endTurn(room, "b").ok).toBe(false);
  });

  it("zählt verbleibende Karten", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    game.reveal(room, "a", B(0));
    expect(game.remainingCards(room)).toEqual({ a: 8, b: 7 });
  });
});

describe("Undo", () => {
  it("stellt den Zustand vor der letzten Aufdeckung exakt wieder her, inklusive Zugwechsel", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    const before = snapshot(room);
    game.reveal(room, "a", NEUTRAL);
    expect(room.currentTeam).toBe("b");
    expect(game.undo(room).ok).toBe(true);
    expect(snapshot(room)).toEqual(before);
  });

  it("macht ein Spielende rückgängig", () => {
    const room = playing(FIXED);
    const before = snapshot(room);
    game.reveal(room, "a", ASSASSIN);
    game.undo(room);
    expect(snapshot(room)).toEqual(before);
    expect(room.phase).toBe("playing");
    expect(room.winner).toBeUndefined();
  });

  it("geht mehrfach zurück, bis die Historie leer ist", () => {
    const room = playing(FIXED);
    const start = snapshot(room);
    game.reveal(room, "a", A(0));
    game.reveal(room, "a", B(0));
    game.reveal(room, "b", NEUTRAL);
    expect(game.undo(room).ok).toBe(true);
    expect(game.undo(room).ok).toBe(true);
    expect(game.undo(room).ok).toBe(true);
    expect(snapshot(room)).toEqual(start);
    expect(game.undo(room).ok).toBe(false);
  });

  it("nimmt ein späteres manuelles Zugende mit zurück", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    game.endTurn(room, "a");
    game.undo(room);
    expect(room.currentTeam).toBe("a");
    expect(room.cards[A(0)].revealed).toBe(false);
  });

  it("geht in der Lobby nicht", () => {
    expect(game.undo(lobby()).ok).toBe(false);
  });
});

describe("Pause durch „Neue Verbindung erlauben“", () => {
  it("pausiert das Spiel und blockiert Aufdecken und Zugende", () => {
    const room = playing(FIXED);
    game.releaseSlot(room, "b");
    expect(room.phase).toBe("paused");
    expect(room.players.b).toBeUndefined();
    expect(game.reveal(room, "a", A(0)).ok).toBe(false);
    expect(game.endTurn(room, "a").ok).toBe(false);
  });

  it("setzt nach Beitritt eines neuen Geräts mit unverändertem Stand fort", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    game.reveal(room, "a", NEUTRAL);
    const before = snapshot(room);
    game.releaseSlot(room, "a");
    expect(game.claimSlot(room, "a", "neues-token").ok).toBe(true);
    expect(room.phase).toBe("playing");
    expect({ ...snapshot(room), players: before.players }).toEqual(before);
    expect(room.players.a).toBe("neues-token");
    expect(game.teamForToken(room, "token-a")).toBeUndefined();
  });

  it("bleibt bei Undo während der Pause pausiert", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    game.releaseSlot(room, "a");
    game.undo(room);
    expect(room.phase).toBe("paused");
    expect(room.cards[A(0)].revealed).toBe(false);
  });

  it("pausiert beim Undo eines Spielendes, wenn inzwischen ein Slot frei ist", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", ASSASSIN);
    game.releaseSlot(room, "b");
    expect(room.phase).toBe("finished");
    game.undo(room);
    expect(room.phase).toBe("paused");
  });

  it("in der Lobby wird nur der Slot frei", () => {
    const room = lobby();
    game.releaseSlot(room, "a");
    expect(room.phase).toBe("lobby");
    expect(game.missingTeam(room)).toBe("a");
  });
});

describe("Neue Runde", () => {
  it("führt in die Lobby, behält Vorgeber und Team-Anpassungen", () => {
    const room = playing(FIXED);
    game.reveal(room, "a", A(0));
    room.teams.a = { name: "Füchse", color: "orange" };
    game.newRound(room);
    expect(room.phase).toBe("lobby");
    expect(room.cards).toEqual([]);
    expect(room.history).toEqual([]);
    expect(room.players).toEqual({ a: "token-a", b: "token-b" });
    expect(room.startingTeam).toBe("a");
    expect(room.currentTeam).toBe("a");
    expect(room.teams.a).toEqual({ name: "Füchse", color: "orange" });
  });

  it("die nächste Runde hat ein neues Grid", () => {
    const room = playing(FIXED);
    const oldTypes = room.cards.map((c) => c.type);
    game.newRound(room);
    game.startGame(room, WORDS, seeded(99));
    expect(room.cards.map((c) => c.type)).not.toEqual(oldTypes);
  });
});
