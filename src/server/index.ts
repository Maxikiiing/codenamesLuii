import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 8080);
const SWEEP_INTERVAL_MS = 60 * 1000;

const { httpServer, manager } = createApp({ publicUrl: process.env.PUBLIC_URL || undefined });

setInterval(() => {
  for (const code of manager.sweep()) console.log(`Raum ${code} nach 2 Stunden ohne Geräte gelöscht`);
}, SWEEP_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
  console.log(`Codenames Luii läuft auf Port ${PORT}`);
});
