import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";
import { PROJECT_ROOT } from "./paths.js";
import { RoomManager } from "./rooms.js";
import { registerSockets, type SocketOptions } from "./sockets.js";
import { wordListInfos } from "./words.js";

const bundleDir = path.join(PROJECT_ROOT, "dist/public"); // Client-Bundle von esbuild
const staticDir = path.join(PROJECT_ROOT, "public");

export interface App {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  manager: RoomManager;
}

export function createApp(options: SocketOptions = {}, manager = new RoomManager()): App {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/wordlists", async (_req, res) => {
    res.json(await wordListInfos(options.wordsDir));
  });

  // QR-Code mit der Beitritts-URL eines Raums.
  app.get("/api/rooms/:code/qr.svg", async (req, res) => {
    const entry = manager.get(req.params.code);
    if (!entry) {
      res.status(404).end();
      return;
    }
    try {
      const svg = await QRCode.toString(manager.joinUrl(entry), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      // Die Join-URL eines Raums ändert sich nie.
      res.type("image/svg+xml").set("Cache-Control", "private, max-age=86400").send(svg);
    } catch (err) {
      console.error(err);
      res.status(500).end();
    }
  });

  app.use(express.static(bundleDir));
  app.use(express.static(staticDir));

  // Client-Routen: Screen, Beitritt und Player teilen sich eine Seite.
  app.get(["/screen/:code", "/join", "/join/:code"], (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  const stopSockets = registerSockets(io, manager, options);
  httpServer.on("close", stopSockets);
  return { httpServer, io, manager };
}
