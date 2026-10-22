import { createApp } from "./app.js";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, probeOllama } from "./ollama.js";

const PORT = Number(process.env.PORT ?? 8080);
const SWEEP_INTERVAL_MS = 60 * 1000;

const OLLAMA_URL = process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

const { httpServer, manager } = createApp({
  publicUrl: process.env.PUBLIC_URL || undefined,
  aiProbe: () => probeOllama(OLLAMA_URL, OLLAMA_MODEL),
});

setInterval(() => {
  for (const code of manager.sweep()) console.log(`Raum ${code} nach 2 Stunden ohne Geräte gelöscht`);
}, SWEEP_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
  console.log(`Codenames Luii läuft auf Port ${PORT}`);
});
