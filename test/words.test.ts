import { describe, expect, it } from "vitest";
import path from "node:path";
import { cleanWords, drawWords, listWordLists, loadWordList, MAX_WORD_LENGTH } from "../src/server/words.js";

const WORDS_DIR = path.resolve("words");

describe("cleanWords", () => {
  it("vereinheitlicht Großschreibung und entfernt Duplikate", () => {
    expect(cleanWords(["Mond", "mond", " MOND ", "Stern"])).toEqual(["MOND", "STERN"]);
  });

  it("ignoriert Leerzeilen und Kommentare", () => {
    expect(cleanWords(["", "  ", "# Kommentar", "Apfel"])).toEqual(["APFEL"]);
  });

  it("entfernt Wörter über 12 Zeichen, Umlaute zählen als ein Zeichen", () => {
    expect(cleanWords(["Zwölfzeichen", "Dreizehnzeich", "Schlüsselbund"])).toEqual(["ZWÖLFZEICHEN"]);
  });
});

describe("drawWords", () => {
  it("zieht 25 unterschiedliche Wörter", () => {
    const words = Array.from({ length: 30 }, (_, i) => `W${i}`);
    const drawn = drawWords(words);
    expect(drawn).toHaveLength(25);
    expect(new Set(drawn).size).toBe(25);
  });

  it("wirft bei zu kurzer Liste", () => {
    expect(() => drawWords(["A", "B"])).toThrow();
  });
});

describe("mitgelieferte Wortlisten", () => {
  it("de-standard hat mindestens 400 bereinigte Wörter", async () => {
    const words = await loadWordList("de-standard", WORDS_DIR);
    expect(words.length).toBeGreaterThanOrEqual(400);
    expect(words.every((w) => [...w].length <= MAX_WORD_LENGTH)).toBe(true);
  });

  it("listet Listen ohne Lizenzdateien", async () => {
    const names = await listWordLists(WORDS_DIR);
    expect(names).toContain("de-standard");
    expect(names.some((n) => n.startsWith("LICENSE"))).toBe(false);
  });

  it("lehnt Pfade als Listennamen ab", async () => {
    await expect(loadWordList("../package", WORDS_DIR)).rejects.toThrow();
  });
});
