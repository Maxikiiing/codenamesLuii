// Bereinigt alle Wortlisten in words/ in place: Duplikate raus, Wörter über 12 Zeichen raus,
// Großschreibung vereinheitlichen, alphabetisch sortieren. Der Kommentarblock (#) am
// Dateianfang bleibt als Kopf erhalten, Kommentare zwischen den Wörtern entfallen.
// Aufruf: npm run words:clean
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanWords, listWordLists, splitLines, WORDS_DIR } from "../src/server/words.js";

for (const name of await listWordLists()) {
  const file = path.join(WORDS_DIR, `${name}.txt`);
  const lines = splitLines(await readFile(file, "utf8")).map((l) => l.trim());
  const firstWord = lines.findIndex((l) => l && !l.startsWith("#"));
  const header = (firstWord === -1 ? lines : lines.slice(0, firstWord)).filter((l) => l.startsWith("#"));
  const before = lines.filter((l) => l && !l.startsWith("#")).length;
  const words = cleanWords(lines).sort((a, b) => a.localeCompare(b, "de"));
  await writeFile(file, [...header, ...words].join("\n") + "\n", "utf8");
  console.log(`${name}: ${before} → ${words.length} Wörter`);
}
