import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_WORD_LENGTH = 12;
export const WORDS_PER_ROUND = 25;

/** Ordner mit den Wortlisten. Im Container per Volume gemountet. */
export const WORDS_DIR = path.resolve(process.env.WORDS_DIR ?? "words");

const LIST_NAME = /^[a-z0-9][a-z0-9-]*$/i;

/**
 * Bereinigt rohe Zeilen einer Wortliste: trimmt, ignoriert Leerzeilen und #-Kommentare,
 * vereinheitlicht auf Großbuchstaben, entfernt zu lange Wörter und Duplikate.
 */
export function cleanWords(lines: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const word = line.replace(/\s+/g, " ").toLocaleUpperCase("de-DE");
    if ([...word].length > MAX_WORD_LENGTH) continue;
    seen.add(word);
  }
  return [...seen];
}

export function parseWordList(text: string): string[] {
  return cleanWords(text.replace(/^﻿/, "").split(/\r?\n/));
}

/** Namen aller verfügbaren Listen (Dateiname ohne `.txt`), alphabetisch. */
export async function listWordLists(dir = WORDS_DIR): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".txt") && !e.name.startsWith("LICENSE"))
    .map((e) => e.name.slice(0, -".txt".length))
    .filter((name) => LIST_NAME.test(name))
    .sort();
}

/** Lädt eine Liste frisch von der Platte, damit neue Listen ohne Neubau nutzbar sind. */
export async function loadWordList(name: string, dir = WORDS_DIR): Promise<string[]> {
  if (!LIST_NAME.test(name)) throw new Error(`Ungültiger Listenname: ${name}`);
  const text = await readFile(path.join(dir, `${name}.txt`), "utf8");
  return parseWordList(text);
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
