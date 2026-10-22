import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { WordListInfo } from "../shared/types.js";
import { PROJECT_ROOT } from "./paths.js";
import { shuffle, type Random } from "./random.js";

export type { WordListInfo };

export const MAX_WORD_LENGTH = 12;
export const WORDS_PER_ROUND = 25;

/** Ordner mit den Wortlisten. Im Container per Volume gemountet. */
export const WORDS_DIR = path.resolve(PROJECT_ROOT, process.env.WORDS_DIR ?? "words");

/** Erlaubt alle Dateinamen außer Pfadangaben und versteckten Dateien. */
export function isValidListName(name: string): boolean {
  return name.length > 0 && !name.startsWith(".") && !/[/\\]/.test(name);
}

const isLicenseFile = (file: string) => file.toLowerCase().startsWith("license");

/**
 * Bereinigt rohe Zeilen einer Wortliste: trimmt, ignoriert Leerzeilen und #-Kommentare,
 * entfernt Wörter über 12 Zeichen, vereinheitlicht auf Großbuchstaben und entfernt Duplikate.
 * Die Länge zählt vor dem Umwandeln, und ß bleibt als ẞ erhalten, damit z. B. „Maße“ und
 * „Masse“ nicht zusammenfallen.
 */
export function cleanWords(lines: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line || line.startsWith("#")) continue;
    if ([...line].length > MAX_WORD_LENGTH) continue;
    seen.add(line.replace(/ß/g, "ẞ").toLocaleUpperCase("de-DE"));
  }
  return [...seen];
}

export function splitLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r?\n/);
}

export function parseWordList(text: string): string[] {
  return cleanWords(splitLines(text));
}

/** Namen aller Listen (Dateiname ohne `.txt`, kleingeschrieben), alphabetisch, ohne Lizenzdateien. */
export async function listWordLists(dir = WORDS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".txt") && !isLicenseFile(e.name))
    .map((e) => e.name.slice(0, -".txt".length))
    .filter(isValidListName)
    .sort((a, b) => a.localeCompare(b, "de"));
}

// Geparste Listen, neu gelesen, sobald sich Änderungszeit oder Größe der Datei ändern.
const cache = new Map<string, { mtimeMs: number; size: number; words: string[] }>();

/** Lädt eine Liste. Neue oder geänderte Dateien werden ohne Neustart erkannt. */
export async function loadWordList(name: string, dir = WORDS_DIR): Promise<string[]> {
  if (!isValidListName(name)) throw new Error(`Ungültiger Listenname: ${name}`);
  const file = path.join(dir, `${name}.txt`);
  const { mtimeMs, size } = await stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.words;
  const words = parseWordList(await readFile(file, "utf8"));
  cache.set(file, { mtimeMs, size, words });
  return words;
}

/** Alle lesbaren Listen mit Wortanzahl. Unlesbare Dateien werden übersprungen und geloggt. */
export async function wordListInfos(dir = WORDS_DIR): Promise<WordListInfo[]> {
  let names: string[];
  try {
    names = await listWordLists(dir);
  } catch (err) {
    console.error(`Wortlisten-Ordner ${dir} nicht lesbar:`, err);
    return [];
  }
  // Gelöschte Listen aus dem Cache entfernen.
  const files = new Set(names.map((name) => path.join(dir, `${name}.txt`)));
  for (const file of cache.keys()) {
    if (path.dirname(file) === dir && !files.has(file)) cache.delete(file);
  }
  const results = await Promise.allSettled(names.map((name) => loadWordList(name, dir)));
  const infos: WordListInfo[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`Wortliste ${names[i]} nicht lesbar:`, result.reason);
      return;
    }
    const count = result.value.length;
    infos.push({ name: names[i], count, usable: count >= WORDS_PER_ROUND });
  });
  return infos;
}

/** Zieht `count` unterschiedliche Wörter zufällig (Fisher-Yates auf einer Kopie). */
export function drawWords(words: readonly string[], count = WORDS_PER_ROUND, random: Random = Math.random): string[] {
  if (words.length < count) {
    throw new Error(`Wortliste hat nur ${words.length} Wörter, gebraucht werden ${count}.`);
  }
  return shuffle([...words], random).slice(0, count);
}
