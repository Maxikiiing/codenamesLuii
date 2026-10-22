import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cleanWords,
  drawWords,
  listWordLists,
  loadWordList,
  MAX_WORD_LENGTH,
  wordListInfos,
} from "../src/server/words.js";

async function tempWords(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "words-"));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Wort${i}`).join("\n");

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

  it("erhält ß, prüft die Länge vor dem Umwandeln und lässt Maße und Masse getrennt", () => {
    expect(cleanWords(["Fußballspiel", "Maße", "Masse", "Strauß"])).toEqual([
      "FUẞBALLSPIEL",
      "MAẞE",
      "MASSE",
      "STRAUẞ",
    ]);
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

describe("Wortlisten-Ordner", () => {
  it("findet Listen mit Unterstrich, Umlaut und Leerzeichen, ignoriert Lizenzen in jeder Schreibweise", async () => {
    const dir = await tempWords({
      "de_wg.txt": lines(30),
      "wörter.txt": lines(30),
      "meine liste.txt": lines(30),
      "License.txt": "MIT",
      "license-foo.txt": "MIT",
      ".versteckt.txt": lines(30),
      "notizen.md": "x",
    });
    expect(await listWordLists(dir)).toEqual(["de_wg", "meine liste", "wörter"]);
  });

  it("markiert Listen unter 25 Wörtern als nicht nutzbar", async () => {
    const dir = await tempWords({ "kurz.txt": lines(10), "lang.txt": lines(25) });
    expect(await wordListInfos(dir)).toEqual([
      { name: "kurz", count: 10, usable: false },
      { name: "lang", count: 25, usable: true },
    ]);
  });

  it("erkennt geänderte Dateien ohne Neustart", async () => {
    const dir = await tempWords({ "x.txt": lines(25) });
    expect(await loadWordList("x", dir)).toHaveLength(25);
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(path.join(dir, "x.txt"), lines(30));
    expect(await loadWordList("x", dir)).toHaveLength(30);
  });

  it("liefert für einen fehlenden Ordner eine leere Liste statt eines Fehlers", async () => {
    expect(await wordListInfos(path.join(os.tmpdir(), "gibt-es-nicht-" + Date.now()))).toEqual([]);
  });
});
