import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { createApp, type App } from "../src/server/app.js";
import type {
  Ack,
  Action,
  AiStatus,
  ClientToServerEvents,
  PlayerState,
  PublicState,
  ServerToClientEvents,
  TeamId,
} from "../src/shared/types.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { states: (PublicState | PlayerState)[] };

let app: App | undefined;
const clients: Client[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  if (app) {
    app.io.close();
    await new Promise((resolve) => app!.httpServer.close(resolve));
    app = undefined;
  }
});

/** Server mit steuerbarer Verfügbarkeitsprüfung. */
async function server(initial?: AiStatus, aiRecheckMs = 30) {
  const probe = { status: initial, calls: 0, fail: false };
  app = createApp({
    wordsDir: path.resolve("words"),
    aiProbe: initial
      ? async () => {
          probe.calls++;
          if (probe.fail) throw new Error("Probe kaputt");
          return probe.status!;
        }
      : undefined,
    aiRecheckMs,
  });
  await new Promise<void>((resolve) => app!.httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(app.httpServer.address() as AddressInfo).port}`;

  async function client(): Promise<Client> {
    const c = connect(url, { transports: ["websocket"], forceNew: true }) as Client;
    c.states = [];
    c.on("state", (s) => c.states.push(s));
    clients.push(c);
    await new Promise<void>((resolve) => c.on("connect", () => resolve()));
    return c;
  }

  const screen = await client();
  const created = await emitAck<{ code: string }>(screen, "createRoom");
  if (!created.ok) throw new Error(created.error);
  await emitAck(screen, "joinScreen", { code: created.code });
  const a = await client();
  const b = await client();
  await emitAck<{ team: TeamId }>(a, "joinPlayer", { code: created.code, team: "a" });
  await emitAck<{ team: TeamId }>(b, "joinPlayer", { code: created.code, team: "b" });
  await settle();
  return { probe, screen, a, b };
}

const latest = <T extends PublicState>(c: Client) => c.states.at(-1) as T;
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function emitAck<T>(c: Client, event: keyof ClientToServerEvents, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) => (c.emit as (...a: unknown[]) => void)(event, ...args, resolve));
}
const act = (c: Client, action: Action) => emitAck(c, "action", action);

const READY: AiStatus = { enabled: true, ready: true };
const LOADING: AiStatus = { enabled: true, ready: false, reason: "Modell wird geladen …" };

describe("Moduswahl über Sockets", () => {
  it("AK1: ohne KI-Modus keine Moduswahl, setMode ai wird abgelehnt", async () => {
    const { screen, a } = await server();
    expect(latest(screen)).toMatchObject({ mode: "classic", aiEnabled: false, aiAvailable: false });
    expect(latest(a).aiEnabled).toBe(false);
    expect((await act(screen, { type: "setMode", mode: "ai" })).ok).toBe(false);
  });

  it("AK1b: Modell lädt noch → angeboten, aber deaktiviert mit Grund", async () => {
    const { screen, a } = await server(LOADING, 60_000);
    expect(latest(screen)).toMatchObject({ aiEnabled: true, aiAvailable: false, aiUnavailableReason: "Modell wird geladen …" });
    const res = await act(a, { type: "setMode", mode: "ai" });
    expect(res).toEqual({ ok: false, error: "Modell wird geladen …" });
  });

  it("AK2: Screen oder Vorgeber wählen KI-Rater, alle sehen den Modus", async () => {
    const { screen, a, b } = await server(READY);
    expect((await act(b, { type: "setMode", mode: "ai" })).ok).toBe(true);
    await settle();
    for (const c of [screen, a, b]) expect(latest(c).mode).toBe("ai");
    expect((await act(screen, { type: "setMode", mode: "classic" })).ok).toBe(true);
    await settle();
    for (const c of [screen, a, b]) expect(latest(c).mode).toBe("classic");
  });

  it("AK2b: wird das Modell bereit, ist KI-Rater ohne Neuladen wählbar", async () => {
    const { probe, screen, a } = await server(LOADING, 30);
    expect(latest(screen).aiAvailable).toBe(false);
    probe.status = READY;
    await settle(150);
    expect(latest(screen).aiAvailable).toBe(true);
    expect(latest(a).aiAvailable).toBe(true);
  });

  it("prüft weiter, wenn der Dienst anfangs nicht auflösbar ist (Container startet vor ollama)", async () => {
    const { probe, screen } = await server({ enabled: false, ready: false }, 30);
    expect(latest(screen).aiEnabled).toBe(false);
    probe.status = READY;
    await settle(150);
    expect(latest(screen)).toMatchObject({ aiEnabled: true, aiAvailable: true });
  });

  it("fällt der KI-Modus während des Spiels weg, landet „Neue Runde“ wieder bei Klassisch", async () => {
    const { probe, screen } = await server(READY, 30);
    await act(screen, { type: "setMode", mode: "ai" });
    expect((await act(screen, { type: "startGame" })).ok).toBe(true);
    probe.status = { enabled: false, ready: false };
    await settle(150);
    expect((await act(screen, { type: "newRound" })).ok).toBe(true);
    await settle();
    expect(latest(screen)).toMatchObject({ phase: "lobby", mode: "classic", aiEnabled: false });
    expect((await act(screen, { type: "startGame" })).ok).toBe(true);
  });

  it("eine fehlschlagende Prüfung bringt den Server nicht zum Absturz", async () => {
    const { probe, screen } = await server(LOADING, 20);
    probe.fail = true;
    await settle(100);
    expect((await act(screen, { type: "setMode", mode: "ai" })).ok).toBe(false);
  });

  it("prüft nicht weiter, sobald der KI-Modus bereit ist", async () => {
    const { probe } = await server(READY, 20);
    const calls = probe.calls;
    await settle(120);
    expect(probe.calls).toBe(calls);
  });

  it("Spielstart im KI-Modus prüft die Verfügbarkeit erneut", async () => {
    const { probe, screen } = await server(READY, 60_000);
    await act(screen, { type: "setMode", mode: "ai" });
    probe.status = { enabled: true, ready: false, reason: "Ollama nicht erreichbar" };
    expect(await act(screen, { type: "startGame" })).toEqual({ ok: false, error: "Ollama nicht erreichbar" });
    probe.status = READY;
    expect((await act(screen, { type: "startGame" })).ok).toBe(true);
  });
});

describe("Hinweis über Sockets", () => {
  async function aiGame() {
    const s = await server(READY, 60_000);
    await act(s.screen, { type: "setMode", mode: "ai" });
    await act(s.screen, { type: "startGame" });
    await settle();
    const state = latest<PlayerState>(s.a);
    const active = state.currentTeam === "a" ? s.a : s.b;
    const passive = active === s.a ? s.b : s.a;
    return { ...s, state, active, passive };
  }

  it("AK4: ein Feldwort als Hinweis wird mit Fehlermeldung abgelehnt", async () => {
    const { active, state } = await aiGame();
    const res = await act(active, { type: "giveClue", word: state.cards[0].word.toLowerCase(), number: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zu nah/);
  });

  it("der Hinweis erscheint auf dem Screen, nur das aktive Team darf ihn geben", async () => {
    const { screen, active, passive } = await aiGame();
    expect((await act(screen, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(false);
    expect((await act(passive, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(false);
    expect((await act(active, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(true);
    await settle();
    expect(latest(screen).currentClue).toMatchObject({ word: "XYLOFON", number: 2, guesses: [] });
  });

  it("AK12b: Undo ist im KI-Modus gesperrt und im State als nicht möglich markiert", async () => {
    const { screen, active, state } = await aiGame();
    await act(active, { type: "giveClue", word: "Xylofon", number: 2 });
    const own = state.key.findIndex((t) => t === state.currentTeam);
    expect((await act(active, { type: "reveal", index: own })).ok).toBe(true);
    await settle();
    expect(latest(screen).canUndo).toBe(false);
    expect((await act(screen, { type: "undo" })).ok).toBe(false);
  });
});
