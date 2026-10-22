import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { createApp, type App } from "../src/server/app.js";
import { RoomManager, ROOM_TTL_MS } from "../src/server/rooms.js";
import type {
  Ack,
  Action,
  ClientToServerEvents,
  PlayerState,
  PublicState,
  ServerToClientEvents,
  TeamId,
} from "../src/shared/types.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: App;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  app = createApp({ wordsDir: path.resolve("words") });
  await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  app.io.close();
  await new Promise((resolve) => app.httpServer.close(resolve));
});

/** Client, der alle empfangenen States mitschreibt. */
async function client(): Promise<Client & { states: (PublicState | PlayerState)[]; kicked: boolean }> {
  const c = connect(url, { transports: ["websocket"], forceNew: true }) as Client & {
    states: (PublicState | PlayerState)[];
    kicked: boolean;
  };
  c.states = [];
  c.kicked = false;
  c.on("state", (s) => c.states.push(s));
  c.on("kicked", () => (c.kicked = true));
  clients.push(c);
  await new Promise<void>((resolve) => c.on("connect", () => resolve()));
  return c;
}

const latest = <T extends PublicState>(c: { states: PublicState[] }) => c.states.at(-1) as T;
const settle = () => new Promise((r) => setTimeout(r, 50));

function emitAck<T>(c: Client, event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => (c.emit as (...a: unknown[]) => void)(event, ...args, resolve));
}
const act = (c: Client, action: Action) => emitAck(c, "action", action);

async function setup() {
  const screen = await client();
  const created = await emitAck<{ code: string }>(screen, "createRoom");
  if (!created.ok) throw new Error(created.error);
  const code = created.code;
  await emitAck(screen, "joinScreen", { code });
  const a = await client();
  const b = await client();
  const joinA = await emitAck<{ team: TeamId; token: string }>(a, "joinPlayer", { code, team: "a" });
  const joinB = await emitAck<{ team: TeamId; token: string }>(b, "joinPlayer", { code, team: "b" });
  if (!joinA.ok || !joinB.ok) throw new Error("join failed");
  await settle();
  return { screen, a, b, code, tokenA: joinA.token, tokenB: joinB.token };
}

async function startedGame() {
  const s = await setup();
  expect((await act(s.screen, { type: "startGame" })).ok).toBe(true);
  await settle();
  const state = latest<PlayerState>(s.a);
  const active = state.currentTeam === "a" ? s.a : s.b;
  const passive = active === s.a ? s.b : s.a;
  return { ...s, key: state.key, active, passive, activeTeam: state.currentTeam };
}

describe("Räume und Beitritt", () => {
  it("erstellt Räume mit 4-Buchstaben-Code", async () => {
    const { code } = await setup();
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  it("lehnt ein drittes Gerät für ein belegtes Team ab", async () => {
    const { code } = await setup();
    const third = await client();
    const res = await emitAck(third, "joinPlayer", { code, team: "a" });
    expect(res.ok).toBe(false);
  });

  it("findet Räume unabhängig von Groß-/Kleinschreibung und meldet unbekannte", async () => {
    const { code } = await setup();
    const c = await client();
    expect((await emitAck(c, "peekRoom", { code: code.toLowerCase() })).ok).toBe(true);
    expect((await emitAck(c, "peekRoom", { code: "ZZZZ" })).ok).toBe(false);
  });

  it("„Spiel starten“ geht erst mit beiden Vorgebern", async () => {
    const screen = await client();
    const created = await emitAck<{ code: string }>(screen, "createRoom");
    if (!created.ok) throw new Error();
    await emitAck(screen, "joinScreen", { code: created.code });
    const a = await client();
    await emitAck(a, "joinPlayer", { code: created.code, team: "a" });
    expect((await act(screen, { type: "startGame" })).ok).toBe(false);
  });

  it("Team-Änderungen erscheinen live, Player dürfen nur ihr eigenes Team ändern", async () => {
    const { screen, a, b } = await setup();
    expect((await act(a, { type: "updateTeam", team: "a", name: "Füchse", color: "orange" })).ok).toBe(true);
    expect((await act(a, { type: "updateTeam", team: "b", name: "Hack" })).ok).toBe(false);
    expect((await act(b, { type: "updateTeam", team: "b", color: "orange" })).ok).toBe(false);
    expect((await act(screen, { type: "updateTeam", team: "b", name: "Eulen" })).ok).toBe(true);
    await settle();
    for (const c of [screen, a, b]) {
      expect(latest(c).teams).toEqual({
        a: { name: "Füchse", color: "orange" },
        b: { name: "Eulen", color: "blue" },
      });
    }
  });

  it("Wortliste lässt sich wählen, unbekannte Listen werden abgelehnt", async () => {
    const { screen } = await setup();
    expect((await act(screen, { type: "setWordList", wordList: "de-popkultur" })).ok).toBe(true);
    expect((await act(screen, { type: "setWordList", wordList: "../package" })).ok).toBe(false);
    await settle();
    expect(latest(screen).wordList).toBe("de-popkultur");
    expect(latest(screen).wordLists).toEqual(expect.arrayContaining(["de-standard", "de-popkultur"]));
  });
});

describe("Datentrennung", () => {
  it("der Screen erhält nie geheime Typen, beide Player dieselbe vollständige Karte", async () => {
    const g = await startedGame();
    const screenState = latest(g.screen);
    expect(screenState.cards).toHaveLength(25);
    expect(screenState.cards.every((c) => !("type" in c))).toBe(true);
    expect(JSON.stringify(g.screen.states)).not.toMatch(/"key"|assassin|neutral/);

    const keyA = latest<PlayerState>(g.a).key;
    const keyB = latest<PlayerState>(g.b).key;
    expect(keyA).toHaveLength(25);
    expect(keyA).toEqual(keyB);
  });

  it("nach dem Aufdecken sieht der Screen nur den Typ dieser Karte", async () => {
    const g = await startedGame();
    const index = g.key.findIndex((t) => t === "neutral");
    expect((await act(g.active, { type: "reveal", index })).ok).toBe(true);
    await settle();
    const cards = latest(g.screen).cards;
    expect(cards[index]).toMatchObject({ revealed: true, type: "neutral" });
    expect(cards.filter((c) => "type" in c)).toHaveLength(1);
  });

  it("ein Beobachter ohne Token bekommt per peekRoom nur öffentlichen State", async () => {
    const g = await startedGame();
    const spy = await client();
    const res = await emitAck<{ state: PublicState }>(spy, "peekRoom", { code: g.code });
    expect(res.ok && JSON.stringify(res.state)).not.toMatch(/"key"|assassin/);
  });
});

describe("Spielzüge", () => {
  it("nur der Player des aktiven Teams kann aufdecken oder den Zug beenden", async () => {
    const g = await startedGame();
    expect((await act(g.passive, { type: "reveal", index: 0 })).ok).toBe(false);
    expect((await act(g.passive, { type: "endTurn" })).ok).toBe(false);
    expect((await act(g.screen, { type: "reveal", index: 0 })).ok).toBe(false);
    expect((await act(g.screen, { type: "endTurn" })).ok).toBe(false);
    expect((await act(g.active, { type: "endTurn" })).ok).toBe(true);
    await settle();
    expect(latest(g.screen).currentTeam).not.toBe(g.activeTeam);
  });

  it("Aufdecken erreicht alle Geräte in unter einer Sekunde", async () => {
    const g = await startedGame();
    const index = g.key.findIndex((t) => t === g.activeTeam);
    const started = Date.now();
    const seen = Promise.all(
      [g.screen, g.a, g.b].map(
        (c) => new Promise<void>((resolve) => c.on("state", (s) => s.cards[index].revealed && resolve())),
      ),
    );
    await act(g.active, { type: "reveal", index });
    await seen;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("Attentäter beendet das Spiel, Undo stellt es wieder her", async () => {
    const g = await startedGame();
    const index = g.key.indexOf("assassin");
    await act(g.active, { type: "reveal", index });
    await settle();
    expect(latest(g.screen)).toMatchObject({ phase: "finished", winReason: "assassin" });
    expect(latest(g.screen).winner).not.toBe(g.activeTeam);

    expect((await act(g.screen, { type: "undo" })).ok).toBe(true);
    await settle();
    expect(latest(g.screen)).toMatchObject({ phase: "playing", currentTeam: g.activeTeam, canUndo: false });
    expect(latest(g.screen).cards[index].revealed).toBe(false);
  });

  it("Neue Runde führt in die Lobby, Player bleiben verbunden", async () => {
    const g = await startedGame();
    await act(g.b, { type: "newRound" });
    await settle();
    expect(latest(g.screen)).toMatchObject({ phase: "lobby", cards: [], connected: { a: true, b: true } });
    expect((await act(g.screen, { type: "startGame" })).ok).toBe(true);
  });
});

describe("Wiederverbindung", () => {
  it("ein Player mit Token bekommt nach Neuladen denselben Slot und Stand", async () => {
    const g = await startedGame();
    const index = g.key.findIndex((t) => t === g.activeTeam);
    await act(g.active, { type: "reveal", index });
    g.a.disconnect();
    await settle();
    expect(latest(g.screen).connected.a).toBe(false);

    const reloaded = await client();
    const res = await emitAck<{ team: TeamId }>(reloaded, "joinPlayer", { code: g.code, token: g.tokenA });
    expect(res.ok && res.team).toBe("a");
    await settle();
    const state = latest<PlayerState>(reloaded);
    expect(state.key).toEqual(g.key);
    expect(state.cards[index].revealed).toBe(true);
    expect(latest(g.screen).connected.a).toBe(true);
  });

  it("der Screen lädt einen laufenden Raum über den Code neu", async () => {
    const g = await startedGame();
    const screen2 = await client();
    expect((await emitAck(screen2, "joinScreen", { code: g.code })).ok).toBe(true);
    await settle();
    expect(latest(screen2).phase).toBe("playing");
    expect(latest(screen2).cards).toEqual(latest(g.screen).cards);
  });
});

describe("Neue Verbindung erlauben", () => {
  it("trennt das alte Gerät dauerhaft, pausiert und setzt mit neuem Gerät fort", async () => {
    const g = await startedGame();
    const index = g.key.findIndex((t) => t === g.activeTeam);
    await act(g.active, { type: "reveal", index });
    await settle();
    const before = latest(g.screen);

    expect((await act(g.screen, { type: "releaseSlot", team: "a" })).ok).toBe(true);
    await settle();
    expect(g.a.kicked).toBe(true);
    expect(latest(g.screen)).toMatchObject({ phase: "paused", waitingFor: "a", slots: { a: false, b: true } });

    // Altes Gerät: Aktionen und Token gelten nicht mehr.
    expect((await act(g.a, { type: "endTurn" })).ok).toBe(false);
    const old = await client();
    const rejoin = await emitAck(old, "joinPlayer", { code: g.code, token: g.tokenA });
    expect(rejoin.ok).toBe(false);

    // Während der Pause kein Zug.
    const activeNow = g.activeTeam === "b" ? g.b : undefined;
    if (activeNow) expect((await act(activeNow, { type: "endTurn" })).ok).toBe(false);

    const fresh = await client();
    expect((await emitAck(fresh, "joinPlayer", { code: g.code, team: "a" })).ok).toBe(true);
    await settle();
    const after = latest(g.screen);
    expect(after.phase).toBe("playing");
    expect(after.cards).toEqual(before.cards);
    expect(after.currentTeam).toBe(before.currentTeam);
    expect(latest<PlayerState>(fresh).key).toEqual(g.key);
  });

  it("ein Player kann seinen eigenen Slot freigeben", async () => {
    const g = await setup();
    expect((await act(g.a, { type: "releaseSlot", team: "a" })).ok).toBe(true);
    await settle();
    expect(g.a.kicked).toBe(true);
    expect(latest(g.screen).slots.a).toBe(false);
  });
});

describe("Raumwechsel", () => {
  it("der alte Raum erfährt, dass ein Player in einen anderen Raum gewechselt ist", async () => {
    const g = await setup();
    const other = await client();
    const created = await emitAck<{ code: string }>(other, "createRoom");
    if (!created.ok) throw new Error();
    expect((await emitAck(g.a, "joinScreen", { code: created.code })).ok).toBe(true);
    await settle();
    expect(latest(g.screen).connected.a).toBe(false);
  });
});

describe("Raum-Lebensdauer", () => {
  it("löscht Räume erst 2 Stunden nachdem das letzte Gerät weg ist", () => {
    let now = 0;
    const manager = new RoomManager(() => now);
    const entry = manager.create("http://192.168.1.20:8080", "de-standard");
    manager.connect(entry, "screen");
    now = ROOM_TTL_MS * 3;
    expect(manager.sweep()).toEqual([]);
    manager.disconnect(entry, "screen");
    now += ROOM_TTL_MS - 1;
    expect(manager.sweep()).toEqual([]);
    now += 1;
    expect(manager.sweep()).toEqual([entry.room.code]);
    expect(manager.size).toBe(0);
  });

  it("erlaubt mehrere Räume gleichzeitig", () => {
    const manager = new RoomManager();
    const codes = new Set(Array.from({ length: 50 }, () => manager.create("http://x", "l").room.code));
    expect(codes.size).toBe(50);
  });
});

describe("Join-URL", () => {
  it("nutzt PUBLIC_URL, wenn gesetzt", () => {
    const manager = new RoomManager();
    const entry = manager.create("http://192.168.1.20:8080", "de-standard");
    const state = manager.publicState(entry, []);
    expect(state.joinUrl).toBe(`http://192.168.1.20:8080/join/${entry.room.code}`);
    expect(state.joinUrlIsLocal).toBe(false);
  });

  it("warnt bei localhost", () => {
    const manager = new RoomManager();
    expect(manager.publicState(manager.create("http://localhost:8080", "x"), []).joinUrlIsLocal).toBe(true);
    expect(manager.publicState(manager.create("http://127.0.0.1:8080", "x"), []).joinUrlIsLocal).toBe(true);
  });
});
