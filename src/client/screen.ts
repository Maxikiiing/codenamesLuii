// Screen: öffentliche Ansicht für Fernseher oder Laptop. Erhält nie die geheime Karte.

import { otherTeam, TEAM_IDS, type PublicState, type TeamId } from "../shared/types.js";
import { cardColors, teamColor } from "./colors.js";
import { teamEditor } from "./lobby.js";
import { request, socket } from "./net.js";
import { closeDialog, confirmDialog, errorPage, gearButton, h, mount, run, teamLabel } from "./ui.js";

export function startScreen(root: HTMLElement, code: string): void {
  document.body.classList.add("view-screen");
  let state: PublicState | undefined;
  let previous: PublicState | undefined;

  const join = async () => {
    const res = await request("joinScreen", { code });
    if (!res.ok) errorPage(root, "Raum nicht gefunden", `Den Raum ${code} gibt es nicht (mehr). Starte ein neues Spiel.`);
  };
  socket.on("connect", join);
  if (socket.connected) void join();

  socket.on("disconnect", () => document.body.classList.add("offline"));
  socket.on("connect", () => document.body.classList.remove("offline"));

  socket.on("state", (s) => {
    previous = state;
    state = s;
    if (previous && previous.phase !== s.phase) closeDialog();
    render();
  });

  const gear = gearButton(() => state);

  function render(): void {
    if (!state) return;
    const view = state.phase === "lobby" ? lobbyView(state) : gameView(state, previous);
    mount(root, view, gear);
  }
}

// Lobby und Pause-Overlay sind nie gleichzeitig sichtbar, also reicht ein <img>, das bei jedem
// Rendern wiederverwendet wird, damit der QR-Code nicht neu lädt.
let qrImage: HTMLImageElement | undefined;

function qr(state: PublicState): HTMLElement {
  const src = `/api/rooms/${state.code}/qr.svg`;
  if (qrImage?.getAttribute("src") !== src) {
    qrImage = h("img", { class: "qr", src, alt: `QR-Code zum Beitreten: ${state.joinUrl}` });
  }
  return qrImage;
}

function joinInfo(state: PublicState): HTMLElement {
  return h(
    "div",
    { class: "join-info" },
    qr(state),
    h(
      "div",
      {},
      h("div", { class: "label" }, "Raumcode"),
      h("div", { class: "room-code" }, state.code),
      h("div", { class: "join-url" }, state.joinUrl),
    ),
  );
}

function lobbyView(state: PublicState): HTMLElement {
  const ready = TEAM_IDS.every((t) => state.connected[t]);
  const select = h(
    "select",
    {
      class: "select",
      "aria-label": "Wortliste",
      onchange: (e: Event) => void run({ type: "setWordList", wordList: (e.target as HTMLSelectElement).value }),
    },
    ...state.wordLists.map((name) => h("option", { value: name, selected: name === state.wordList }, name)),
  );

  return h(
    "div",
    { class: "screen-lobby" },
    h("h1", { class: "title" }, "Codenames Luii"),
    state.joinUrlIsLocal &&
      h(
        "p",
        { class: "warning" },
        "Achtung: Der QR-Code zeigt auf localhost und funktioniert auf Handys nicht. Öffne diese Seite über die LAN-IP des Rechners (z. B. http://192.168.1.20:8080) oder setze PUBLIC_URL in der .env-Datei.",
      ),
    h(
      "div",
      { class: "lobby-columns" },
      joinInfo(state),
      h(
        "div",
        { class: "lobby-setup" },
        h("div", { class: "teams" }, teamEditor(state, "a", true), teamEditor(state, "b", true)),
        h("label", { class: "wordlist" }, "Wortliste ", select),
        h(
          "button",
          {
            class: "btn primary big",
            disabled: !ready,
            onclick: () => void run({ type: "startGame" }),
          },
          "Spiel starten",
        ),
        !ready && h("p", { class: "hint" }, "Beide Vorgeber müssen verbunden sein. Scannt dazu den QR-Code."),
      ),
    ),
  );
}

function gameView(state: PublicState, previous: PublicState | undefined): HTMLElement {
  const header = h(
    "header",
    { class: "screen-header" },
    scoreBox(state, "a"),
    h("div", { class: "turn" }, turnText(state)),
    scoreBox(state, "b"),
  );

  const grid = h(
    "div",
    { class: "grid screen-grid" },
    ...state.cards.map((card, i) => {
      const justRevealed = card.revealed && previous?.cards[i] && !previous.cards[i].revealed;
      const colors = card.revealed && card.type ? cardColors(card.type, state.teams) : undefined;
      return h(
        "div",
        {
          class: `card${card.revealed ? ` revealed type-${card.type}` : ""}${justRevealed ? " flip" : ""}`,
          style: colors ? { background: colors.bg, color: colors.fg } : {},
        },
        h("span", { class: "word" }, card.word),
      );
    }),
  );

  const nodes: HTMLElement[] = [header, grid];

  if (state.phase === "finished" && state.winner) {
    const loser = otherTeam(state.winner);
    const reason =
      state.winReason === "assassin"
        ? `${state.teams[loser].name} hat den Attentäter aufgedeckt.`
        : "Alle Karten gefunden.";
    nodes.push(
      h(
        "div",
        { class: "banner winner", style: { background: teamColor(state.teams, state.winner).bg, color: teamColor(state.teams, state.winner).fg } },
        h("div", { class: "winner-title" }, `${state.teams[state.winner].name} gewinnt!`),
        h("div", { class: "winner-reason" }, reason),
        h(
          "button",
          {
            class: "btn plain",
            onclick: async () => {
              if (await confirmDialog("Neue Runde starten?", "Zurück in die Lobby mit neuem Spielfeld.", "Neue Runde")) {
                await run({ type: "newRound" });
              }
            },
          },
          "Neue Runde",
        ),
      ),
    );
  }

  if (state.phase === "paused" && state.waitingFor) {
    nodes.push(
      h(
        "div",
        { class: "overlay" },
        h(
          "div",
          { class: "overlay-box" },
          h("h2", {}, "Spiel pausiert"),
          h("p", { class: "big-text" }, "Warte auf Vorgeber ", teamLabel(state, state.waitingFor)),
          joinInfo(state),
        ),
      ),
    );
  }

  return h("div", { class: `screen-game phase-${state.phase}` }, ...nodes);
}

function scoreBox(state: PublicState, team: TeamId): HTMLElement {
  const c = teamColor(state.teams, team);
  const active = state.phase !== "finished" && state.currentTeam === team;
  return h(
    "div",
    { class: `score${active ? " active" : ""}`, style: { background: c.bg, color: c.fg } },
    h("div", { class: "score-name" }, state.teams[team].name),
    h("div", { class: "score-count" }, String(state.remaining[team])),
    h("div", { class: "score-label" }, state.remaining[team] === 1 ? "Karte übrig" : "Karten übrig"),
  );
}

function turnText(state: PublicState): Node {
  if (state.phase === "finished") return document.createTextNode("Spielende");
  return h("span", {}, teamLabel(state, state.currentTeam, "team-label big"), h("span", {}, " ist am Zug"));
}
