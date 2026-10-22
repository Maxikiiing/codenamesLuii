import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_WORD_LENGTH = 12;
export const WORDS_PER_ROUND = 25;

// src/server und dist/server liegen beide zwei Ebenen unter dem Projektordner.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Ordner mit den Wortlisten. Im Container per Volume gemountet. */
export const WORDS_DIR = path.resolve(projectRoot, process.env.WORDS_DIR ?? "words");

export interface WordListInfo {
  name: string;
  count: number;
  /** Mindestens 25 Wörter, also für eine Runde nutzbar. */
  usable: boolean;
}

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

/** Namen aller Listen (Dateiname ohne `.txt`), alphabetisch, ohne Lizenzdateien. */
export async function listWordLists(dir = WORDS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".txt") && !isLicenseFile(e.name))
    .map((e) => e.name.slice(0, -".txt".length))
    .filter(isValidListName)
    .sort((a, b) => a.localeCompare(b, "de"));
}

// Geparste Listen, neu gelesen, sobald sich die Datei ändert.
const cache = new Map<string, { mtimeMs: number; words: string[] }>();

/** Lädt eine Liste. Neue oder geänderte Dateien werden ohne Neustart erkannt. */
export async function loadWordList(name: string, dir = WORDS_DIR): Promise<string[]> {
  if (!isValidListName(name)) throw new Error(`Ungültiger Listenname: ${name}`);
  const file = path.join(dir, `${name}.txt`);
  const { mtimeMs } = await stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.words;
  const words = parseWordList(await readFile(file, "utf8"));
  cache.set(file, { mtimeMs, words });
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
export function drawWords(words: readonly string[], count = WORDS_PER_ROUND, random = Math.random): string[] {
  if (words.length < count) {
    throw new Error(`Wortliste hat nur ${words.length} Wörter, gebraucht werden ${count}.`);
  }
  const pool = [...words];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
