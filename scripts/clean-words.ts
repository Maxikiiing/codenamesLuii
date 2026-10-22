// Bereinigt alle Wortlisten in words/ in place: Duplikate raus, Wörter über 12 Zeichen raus,
// Großschreibung vereinheitlichen, alphabetisch sortieren. Aufruf: npm run words:clean
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listWordLists, parseWordList, WORDS_DIR } from "../src/server/words.js";

for (const name of await listWordLists()) {
  const file = path.join(WORDS_DIR, `${name}.txt`);
  const before = (await readFile(file, "utf8")).split(/\r?\n/).filter((l) => l.trim()).length;
  const words = parseWordList(await readFile(file, "utf8")).sort((a, b) => a.localeCompare(b, "de"));
  await writeFile(file, words.join("\n") + "\n", "utf8");
  console.log(`${name}: ${before} → ${words.length} Wörter`);
}
