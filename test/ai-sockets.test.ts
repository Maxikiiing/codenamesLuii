import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { createApp, type App } from "../src/server/app.js";
import type { ChatClient } from "../src/server/ollama.js";
import type { SocketOptions } from "../src/server/sockets.js";
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
async function server(initial?: AiStatus, aiRecheckMs = 30, extra: Partial<SocketOptions> = {}) {
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
    ...extra,
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

/** Fake-Ollama: liefert die vorgegebenen Antworten der Reihe nach, merkt sich die Prompts. */
function fakeClient(answers: (string | ((signal: AbortSignal) => Promise<string>))[]) {
  const prompts: string[] = [];
  const client: ChatClient = {
    async chat(messages, signal) {
      prompts.push(messages.map((m) => m.content).join("\n"));
      const next = answers.shift();
      if (next === undefined) return new Promise<string>(() => {}); // hängt, bis abgebrochen wird
      return typeof next === "string" ? next : next(signal);
    },
  };
  return { client, prompts, answers };
}

const answer = (thought: string, guess: string | null) => JSON.stringify({ thought, guess });

describe("KI-Zug über Sockets", () => {
  async function aiGame(answers: Parameters<typeof fakeClient>[0] = [], extra: Partial<SocketOptions> = {}) {
    const fake = fakeClient(answers);
    const s = await server(READY, 60_000, { aiClient: fake.client, aiPause: () => 100, ...extra });
    await act(s.screen, { type: "setMode", mode: "ai" });
    await act(s.screen, { type: "startGame" });
    await settle();
    const state = latest<PlayerState>(s.a);
    const active = state.currentTeam === "a" ? s.a : s.b;
    const passive = active === s.a ? s.b : s.a;
    const own = state.key.map((t, i) => (t === state.currentTeam ? i : -1)).filter((i) => i >= 0);
    const neutral = state.key.indexOf("neutral");
    return { ...s, fake, state, active, passive, own, neutral, team: state.currentTeam };
  }

  const waitFor = async (check: () => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (!check()) {
      if (Date.now() > end) throw new Error("Zeitüberschreitung beim Warten");
      await settle(10);
    }
  };

  it("lädt das Modell vor, sobald der KI-Modus gewählt und das Spiel gestartet wird", async () => {
    let warmUps = 0;
    const client: ChatClient = { chat: () => new Promise(() => {}), warmUp: async () => void warmUps++ };
    const s = await server(READY, 60_000, { aiClient: client });
    await act(s.screen, { type: "setMode", mode: "ai" });
    await act(s.screen, { type: "startGame" });
    expect(warmUps).toBe(2);
  });

  it("AK4: ein Feldwort als Hinweis wird mit Fehlermeldung abgelehnt", async () => {
    const { active, state } = await aiGame();
    const res = await act(active, { type: "giveClue", word: state.cards[0].word.toLowerCase(), number: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zu nah/);
  });

  it("nur das aktive Team gibt Hinweise, der Screen zeigt ihn", async () => {
    const { screen, active, passive } = await aiGame();
    expect((await act(screen, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(false);
    expect((await act(passive, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(false);
    expect((await act(active, { type: "giveClue", word: "Xylofon", number: 2 })).ok).toBe(true);
    await settle();
    expect(latest(screen).currentClue).toMatchObject({ word: "XYLOFON", number: 2, guesses: [] });
    expect(latest(screen).aiThinking).toBe(true);
  });

  it("AK7: der Gedanke steht vor dem Aufdecken auf dem Screen; ohne offene alte Wörter ist nach Zahl Schluss", async () => {
    const g = await aiGame();
    const words = g.own.slice(0, 2).map((i) => g.state.cards[i].word);
    g.fake.answers.push(...words.map((w) => answer(`Ich nehme ${w}.`, w.toLowerCase())));
    const times: Record<string, number> = {};
    g.screen.on("state", (s) => {
      if (s.aiThought && !times[s.aiThought]) times[s.aiThought] = Date.now();
      for (const w of words) {
        if (!times[w] && s.cards.find((c) => c.word === w)?.revealed) times[w] = Date.now();
      }
    });
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    for (const w of words) expect(times[w] - times[`Ich nehme ${w}.`]).toBeGreaterThanOrEqual(90);
    expect(latest(g.screen)).toMatchObject({
      aiThinking: false,
      remaining: { [g.team]: g.own.length - 2 },
      aiThought: "Alle 2 Wörter zu „XYLOFON“ gefunden, ich höre auf.",
    });
    expect(g.fake.prompts).toHaveLength(2); // kein dritter Versuch ins Blaue
  });

  it("AK6: `guess: null` beendet den Zug, der Gedanke bleibt stehen", async () => {
    const g = await aiGame([answer("Bei dem Hinweis bin ich mir zu unsicher, ich lasse es.", null)]);
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    expect(latest(g.screen)).toMatchObject({
      aiThinking: false,
      aiThought: "Bei dem Hinweis bin ich mir zu unsicher, ich lasse es.",
      aiThoughtTeam: g.team,
    });
    expect(latest(g.screen).cards.every((c) => !c.revealed)).toBe(true);
  });

  it("AK10: zweimal ein Wort, das nicht auf dem Feld liegt → „Die KI ist ratlos …“", async () => {
    const g = await aiGame([answer("Vielleicht Mond?", "MONDLANDUNG"), "kein json"]);
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    expect(latest(g.screen).aiThought).toBe("Die KI ist ratlos und gibt den Zug ab.");
    expect(g.fake.prompts[1]).toMatch(/MONDLANDUNG.*liegt nicht verdeckt/);
  });

  it("AK11: antwortet Ollama nicht rechtzeitig, endet der Zug und das Spiel bleibt bedienbar", async () => {
    const g = await aiGame([], { aiStepTimeoutMs: 100 });
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    expect(latest(g.screen)).toMatchObject({ aiThinking: false, aiThought: "Die KI hat zu lange überlegt und gibt den Zug ab." });
    expect((await act(g.passive, { type: "giveClue", word: "Zebra", number: 1 })).ok).toBe(true);
  });

  it("AK12: solange die KI rät, lehnt der Server Aufdecken, Zugende und neue Hinweise ab", async () => {
    const g = await aiGame();
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    for (const action of [
      { type: "reveal", index: g.own[0] },
      { type: "endTurn" },
      { type: "giveClue", word: "Zebra", number: 1 },
    ] as Action[]) {
      expect((await act(g.active, action)).ok).toBe(false);
    }
  });

  it("AK12b: Undo ist im KI-Modus gesperrt und im State als nicht möglich markiert", async () => {
    const g = await aiGame();
    g.fake.answers.push(answer("Klar.", g.state.cards[g.own[0]].word), answer("Genug.", null));
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    expect(latest(g.screen).canUndo).toBe(false);
    expect((await act(g.screen, { type: "undo" })).ok).toBe(false);
  });

  it("Pause verwirft den laufenden Schritt, nach dem Fortsetzen fragt die KI neu", async () => {
    const g = await aiGame();
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => g.fake.prompts.length === 1);
    expect((await act(g.screen, { type: "releaseSlot", team: g.team })).ok).toBe(true);
    await settle();
    expect(latest(g.screen)).toMatchObject({ phase: "paused", aiThinking: false });
    g.fake.answers.push(answer("Ich höre auf.", null));
    const rejoin = await (async () => {
      const c = connect(`http://127.0.0.1:${(app!.httpServer.address() as AddressInfo).port}`, {
        transports: ["websocket"],
        forceNew: true,
      }) as Client;
      c.states = [];
      clients.push(c);
      await new Promise<void>((resolve) => c.on("connect", () => resolve()));
      return c;
    })();
    await emitAck(rejoin, "joinPlayer", { code: latest(g.screen).code, team: g.team });
    await waitFor(() => latest(g.screen).currentTeam !== g.team);
    expect(g.fake.prompts).toHaveLength(2);
    expect(latest(g.screen).aiThought).toBe("Ich höre auf.");
  });

  it("„Neue Runde“ bricht die laufende Anfrage ab", async () => {
    let aborted = false;
    const g = await aiGame([
      (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(new Error("abort"))))),
    ]);
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => g.fake.prompts.length === 1);
    await act(g.screen, { type: "newRound" });
    await settle();
    expect(aborted).toBe(true);
    expect(latest(g.screen)).toMatchObject({ phase: "lobby", aiThinking: false, mode: "ai" });
    expect(latest(g.screen).aiThought).toBeUndefined();
  });

  it("die geheime Karte gelangt nie in den Prompt", async () => {
    const g = await aiGame([answer("Ich höre auf.", null)]);
    await act(g.active, { type: "giveClue", word: "Xylofon", number: 2 });
    await waitFor(() => g.fake.prompts.length === 1);
    expect(g.fake.prompts[0]).not.toMatch(/Attentäter \(|neutral\)|euer Team\)|Gegner\)/);
  });
});
