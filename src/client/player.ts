// Player: Handy eines Vorgebers. Zeigt die geheime Karte und erlaubt Aufdecken und Zugende.

import { otherTeam, TEAM_IDS, type PlayerState, type PublicState, type TeamId } from "../shared/types.js";
import { cardColors, teamColor } from "./colors.js";
import { teamEditor } from "./lobby.js";
import { clearToken, loadToken, request, saveToken, socket } from "./net.js";
import { closeDialog, confirmDialog, errorPage, gearButton, h, mount, run, teamLabel, toast } from "./ui.js";

export function startPlayer(root: HTMLElement, code: string): void {
  document.body.classList.add("view-player");
  let state: PlayerState | undefined;
  let kicked = false;
  let joined = false;

  async function join(team?: TeamId): Promise<void> {
    const token = loadToken(code);
    const res = await request<{ team: TeamId; token: string }>("joinPlayer", { code, team, token });
    if (res.ok) {
      joined = true;
      saveToken(code, res.token);
      return;
    }
    if (token) {
      // Token ungültig (z. B. Slot freigegeben): neu wählen lassen.
      clearToken(code);
      if (!team) return chooseTeam();
    }
    if (res.error === "Raum nicht gefunden.") {
      errorPage(root, "Raum nicht gefunden", `Den Raum ${code} gibt es nicht (mehr).`);
      return;
    }
    toast(res.error);
    await chooseTeam();
  }

  async function chooseTeam(): Promise<void> {
    const res = await request<{ state: PublicState }>("peekRoom", { code });
    if (!res.ok) {
      errorPage(root, "Raum nicht gefunden", `Den Raum ${code} gibt es nicht (mehr).`);
      return;
    }
    const s = res.state;
    mount(
      root,
      h(
        "div",
        { class: "center-page" },
        h("h1", {}, "Welches Team führst du?"),
        h("p", {}, `Raum ${s.code}`),
        ...TEAM_IDS.map((team) => {
          const c = teamColor(s.teams, team);
          return h(
            "button",
            {
              class: "btn big team-choice",
              style: { background: c.bg, color: c.fg },
              disabled: s.slots[team],
              onclick: () => void join(team),
            },
            s.teams[team].name,
            s.slots[team] ? h("small", {}, " (schon vergeben)") : "",
          );
        }),
        h("button", { class: "btn plain", onclick: () => void chooseTeam() }, "Aktualisieren"),
      ),
    );
  }

  socket.on("connect", () => {
    document.body.classList.remove("offline");
    // Nach einem Verbindungsabbruch automatisch mit Token zurück, aber nicht nach einer Trennung durch die Spielleitung.
    if (!kicked && (joined || loadToken(code))) void join();
  });
  socket.on("disconnect", () => document.body.classList.add("offline"));
  if (socket.connected) {
    if (loadToken(code)) void join();
    else void chooseTeam();
  } else if (!loadToken(code)) {
    socket.once("connect", () => void chooseTeam());
  }

  socket.on("kicked", () => {
    kicked = true;
    joined = false;
    state = undefined;
    clearToken(code);
    closeDialog();
    mount(
      root,
      h(
        "div",
        { class: "center-page" },
        h("h1", {}, "Getrennt"),
        h("p", {}, "Verbindung wurde durch die Spielleitung getrennt."),
        h("a", { class: "btn plain", href: `/join/${code}` }, "Erneut beitreten"),
      ),
    );
  });

  socket.on("state", (s) => {
    if (kicked || !("key" in s)) return;
    const prev = state;
    state = s;
    if (prev && (prev.phase !== s.phase || prev.currentTeam !== s.currentTeam)) closeDialog();
    render();
  });

  const gear = gearButton(() => state);

  function render(): void {
    if (!state) return;
    mount(root, state.phase === "lobby" ? lobbyView(state) : gameView(state), gear);
  }
}

function lobbyView(state: PlayerState): HTMLElement {
  return h(
    "div",
    { class: "player-lobby" },
    h("p", { class: "muted" }, `Raum ${state.code} · Du bist Vorgeber von`),
    teamEditor(state, state.team, true),
    teamEditor(state, otherTeam(state.team), false),
    h(
      "p",
      { class: "hint" },
      TEAM_IDS.every((t) => state.connected[t])
        ? "Alle bereit. Das Spiel wird am Screen gestartet."
        : "Warte auf den zweiten Vorgeber …",
    ),
  );
}

function gameView(state: PlayerState): HTMLElement {
  const myTurn = state.phase === "playing" && state.currentTeam === state.team;
  const mine = teamColor(state.teams, state.team);

  let statusText: Node;
  if (state.phase === "finished" && state.winner) {
    statusText = h("span", {}, teamLabel(state, state.winner), state.winner === state.team ? " – ihr habt gewonnen!" : " gewinnt.");
  } else if (state.phase === "paused" && state.waitingFor) {
    statusText = h("span", {}, "Pausiert: warte auf Vorgeber ", teamLabel(state, state.waitingFor));
  } else if (myTurn) {
    statusText = h("span", {}, "Dein Team ist am Zug");
  } else {
    statusText = h("span", {}, teamLabel(state, state.currentTeam), " ist am Zug");
  }

  const status = h(
    "div",
    {
      class: `player-status${myTurn ? " my-turn" : ""}`,
      style: myTurn ? { background: mine.bg, color: mine.fg } : {},
    },
    statusText,
  );

  const grid = h(
    "div",
    { class: "grid player-grid" },
    ...state.cards.map((card, i) => {
      const type = state.key[i];
      const c = cardColors(type, state.teams);
      return h(
        "button",
        {
          class: `card type-${type}${card.revealed ? " revealed" : ""}`,
          style: { background: c.bg, color: c.fg },
          disabled: !myTurn || card.revealed,
          "aria-label": `${card.word}${card.revealed ? " (aufgedeckt)" : ""}`,
          onclick: async () => {
            if (await confirmDialog(`„${card.word}“ aufdecken?`, null, "Aufdecken")) {
              await run({ type: "reveal", index: i });
            }
          },
        },
        h("span", { class: "word" }, card.word),
      );
    }),
  );

  const remaining = h(
    "div",
    { class: "player-remaining" },
    ...TEAM_IDS.map((t) => {
      const c = teamColor(state.teams, t);
      return h("span", { class: "pill", style: { background: c.bg, color: c.fg } }, `${state.teams[t].name}: ${state.remaining[t]}`);
    }),
  );

  const endTurn = h(
    "button",
    {
      class: "btn primary big end-turn",
      disabled: !myTurn,
      onclick: async () => {
        if (await confirmDialog("Zug beenden?", "Das andere Team ist dann am Zug.", "Zug beenden")) {
          await run({ type: "endTurn" });
        }
      },
    },
    "Zug beenden",
  );

  return h("div", { class: `player-game phase-${state.phase}` }, status, grid, remaining, endTurn);
}
