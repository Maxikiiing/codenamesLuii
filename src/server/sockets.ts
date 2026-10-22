// socket.io-Anbindung: übersetzt Socket-Events in Spielaktionen und verteilt den
// resultierenden State. Der Screen bekommt nur öffentlichen State, Player mit gültigem
// Token zusätzlich die geheime Karte.

import type { Server, Socket } from "socket.io";
import {
  TEAM_IDS,
  type Action,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type TeamId,
} from "../shared/types.js";
import * as game from "./game.js";
import { RoomManager, type RoomEntry } from "./rooms.js";
import { drawWords, loadWordList, wordListInfos } from "./words.js";

export const DEFAULT_WORD_LIST = "de-standard";
const WORD_LIST_CACHE_MS = 5000;
const VALID_HOST = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;

interface SocketData {
  code?: string;
  role?: "screen" | TeamId;
  token?: string;
}

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketOptions {
  /** Feste öffentliche URL aus PUBLIC_URL, sonst wird sie aus dem Host-Header abgeleitet. */
  publicUrl?: string;
  wordsDir?: string;
}

const publicRoom = (code: string) => `${code}:public`;
const teamRoom = (code: string, team: TeamId) => `${code}:${team}`;
const isTeam = (value: unknown): value is TeamId => TEAM_IDS.includes(value as TeamId);
const err = (error: string) => ({ ok: false as const, error });

/** Ruft `cb` nur auf, wenn der Client wirklich eine Funktion übergeben hat. */
function reply<T>(cb: unknown, res: Ack<T>): void {
  if (typeof cb === "function") cb(res);
}

export function registerSockets(io: AppServer, manager: RoomManager, options: SocketOptions = {}): void {
  // Namen der Listen, die genug Wörter für eine Runde haben. Kurz zwischengespeichert,
  // damit nicht jede Aufdeckung den Wortlisten-Ordner liest.
  let listCache: { at: number; names: Promise<string[]> } | undefined;
  const wordLists = (): Promise<string[]> => {
    const now = Date.now();
    if (!listCache || now - listCache.at > WORD_LIST_CACHE_MS) {
      listCache = {
        at: now,
        names: wordListInfos(options.wordsDir).then((infos) =>
          infos.filter((info) => info.usable).map((info) => info.name),
        ),
      };
    }
    return listCache.names;
  };

  async function broadcast(entry: RoomEntry): Promise<void> {
    const lists = await wordLists();
    const { code } = entry.room;
    io.to(publicRoom(code)).emit("state", manager.publicState(entry, lists));
    for (const team of TEAM_IDS) {
      if (entry.room.players[team]) {
        io.to(teamRoom(code, team)).emit("state", manager.playerState(entry, team, lists));
      }
    }
  }

  function baseUrlFor(socket: AppSocket): string {
    if (options.publicUrl) return options.publicUrl.replace(/\/+$/, "");
    const { headers } = socket.handshake;
    // Nur plausible Host-Angaben (Name oder IP, optional mit Port) übernehmen.
    const host = headers.host && VALID_HOST.test(headers.host) ? headers.host : "localhost";
    // Hinter einem HTTPS-Reverse-Proxy das Protokoll aus dem Proxy-Header übernehmen.
    const forwarded = String(headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
    const proto = forwarded === "https" ? "https" : "http";
    return `${proto}://${host}`;
  }

  /** Löst die Bindung eines Sockets an seinen Raum, z. B. vor einem neuen Beitritt. */
  function detach(socket: AppSocket): RoomEntry | undefined {
    const { code, role } = socket.data;
    socket.data = {};
    if (!code || !role) return undefined;
    void socket.leave(role === "screen" ? publicRoom(code) : teamRoom(code, role));
    const entry = manager.get(code);
    if (entry) manager.disconnect(entry, role);
    return entry;
  }

  /** Trennt alle Geräte eines Teams dauerhaft (Token ist danach ungültig). */
  async function kickTeam(entry: RoomEntry, team: TeamId): Promise<void> {
    const sockets = await io.in(teamRoom(entry.room.code, team)).fetchSockets();
    for (const remote of sockets) {
      remote.emit("kicked");
      const local = io.sockets.sockets.get(remote.id);
      if (local) detach(local);
    }
  }

  /** Liefert Raum und Team des Sockets, wenn er ein Player mit noch gültigem Token ist. */
  function playerOf(socket: AppSocket): { entry: RoomEntry; team: TeamId } | undefined {
    const { code, role, token } = socket.data;
    const entry = manager.get(code);
    if (!entry || !isTeam(role) || entry.room.players[role] !== token) return undefined;
    return { entry, team: role };
  }

  async function handleAction(socket: AppSocket, action: Action): Promise<Ack> {
    const entry = manager.get(socket.data.code);
    if (!entry || !socket.data.role) return err("Du bist mit keinem Raum verbunden.");
    const player = playerOf(socket);
    if (socket.data.role !== "screen" && !player) return err("Deine Verbindung ist nicht mehr gültig.");
    const { room } = entry;
    if (!action || typeof action !== "object") return err("Ungültige Aktion.");

    switch (action.type) {
      case "updateTeam": {
        if (!isTeam(action.team)) return err("Unbekanntes Team.");
        if (player && player.team !== action.team) return err("Du kannst nur dein eigenes Team anpassen.");
        return game.updateTeam(room, action.team, { name: action.name, color: action.color });
      }
      case "setWordList": {
        if (!(await wordLists()).includes(action.wordList)) return err("Diese Wortliste gibt es nicht.");
        return game.setWordList(room, action.wordList);
      }
      case "startGame": {
        if (room.phase !== "lobby") return err("Das Spiel läuft bereits.");
        if (!manager.bothPlayersConnected(entry)) return err("Beide Vorgeber müssen verbunden sein.");
        let words: string[];
        try {
          words = drawWords(await loadWordList(room.wordList, options.wordsDir));
        } catch (e) {
          return err(e instanceof Error ? e.message : "Wortliste konnte nicht geladen werden.");
        }
        return game.startGame(room, words);
      }
      case "reveal":
        if (!player) return err("Nur Vorgeber können Karten aufdecken.");
        return game.reveal(room, player.team, action.index);
      case "endTurn":
        if (!player) return err("Nur Vorgeber können den Zug beenden.");
        return game.endTurn(room, player.team);
      case "newRound":
        return game.newRound(room);
      case "undo":
        return game.undo(room);
      case "releaseSlot": {
        if (!isTeam(action.team)) return err("Unbekanntes Team.");
        await kickTeam(entry, action.team);
        return game.releaseSlot(room, action.team);
      }
      default:
        return err("Unbekannte Aktion.");
    }
  }

  io.on("connection", (socket: AppSocket) => {
    socket.on("createRoom", async (cb) => {
      const lists = await wordLists();
      const wordList = lists.includes(DEFAULT_WORD_LIST) ? DEFAULT_WORD_LIST : (lists[0] ?? DEFAULT_WORD_LIST);
      const entry = manager.create(baseUrlFor(socket), wordList);
      reply(cb, { ok: true, code: entry.room.code });
    });

    socket.on("joinScreen", async (req, cb) => {
      const entry = manager.get(req?.code);
      if (!entry) return reply(cb, err("Raum nicht gefunden."));
      const previous = detach(socket);
      socket.data = { code: entry.room.code, role: "screen" };
      await socket.join(publicRoom(entry.room.code));
      manager.connect(entry, "screen");
      reply(cb, { ok: true });
      if (previous && previous !== entry) await broadcast(previous);
      await broadcast(entry);
    });

    socket.on("peekRoom", async (req, cb) => {
      const entry = manager.get(req?.code);
      if (!entry) return reply(cb, err("Raum nicht gefunden."));
      reply(cb, { ok: true, state: manager.publicState(entry, await wordLists()) });
    });

    socket.on("joinPlayer", async (req, cb) => {
      const entry = manager.get(req?.code);
      if (!entry) return reply(cb, err("Raum nicht gefunden."));
      const { room } = entry;

      // Wiederverbindung: ein gültiges Token stellt denselben Slot wieder her.
      let team = game.teamForToken(room, req.token);
      let token = req.token;
      if (!team) {
        if (!isTeam(req.team)) return reply(cb, err("Bitte ein Team wählen."));
        token = RoomManager.newToken();
        const claimed = game.claimSlot(room, req.team, token);
        if (!claimed.ok) return reply(cb, claimed);
        team = req.team;
      }

      const previous = detach(socket);
      socket.data = { code: room.code, role: team, token };
      await socket.join(teamRoom(room.code, team));
      manager.connect(entry, team);
      reply(cb, { ok: true, team, token: token! });
      if (previous && previous !== entry) await broadcast(previous);
      await broadcast(entry);
    });

    socket.on("action", async (action, cb) => {
      // Vorher merken: „Neue Verbindung erlauben“ kann den eigenen Socket vom Raum lösen.
      const entry = manager.get(socket.data.code);
      let res: Ack;
      try {
        res = await handleAction(socket, action);
      } catch (e) {
        console.error(e);
        res = err("Interner Fehler.");
      }
      reply(cb, res);
      if (res.ok && entry) await broadcast(entry);
    });

    socket.on("disconnect", async () => {
      const entry = detach(socket);
      if (entry) await broadcast(entry);
    });
  });
}
