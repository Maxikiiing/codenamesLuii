import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { listWordLists, loadWordList } from "./words.js";

const PORT = Number(process.env.PORT ?? 8080);
const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server -> dist/public (Client-Bundle) und public/ (statische Dateien)
const bundleDir = path.resolve(here, "../public");
const staticDir = path.resolve(here, "../../public");

const app = express();
app.disable("x-powered-by");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/wordlists", async (_req, res) => {
  try {
    const names = await listWordLists();
    const lists = await Promise.all(
      names.map(async (name) => ({ name, count: (await loadWordList(name)).length })),
    );
    res.json(lists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Wortlisten konnten nicht gelesen werden." });
  }
});

app.use(express.static(bundleDir));
app.use(express.static(staticDir));

const httpServer = createServer(app);
const io = new Server(httpServer);

io.on("connection", (socket) => {
  socket.emit("hello", { server: "codenames-luii" });
});

httpServer.listen(PORT, () => {
  console.log(`Codenames Luii läuft auf Port ${PORT}`);
});
