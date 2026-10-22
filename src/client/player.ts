// Player: Handy eines Vorgebers. Zeigt die geheime Karte und erlaubt Aufdecken und Zugende.

import { MAX_CLUE_LENGTH, MAX_CLUE_NUMBER, MIN_CLUE_NUMBER, otherTeam, TEAM_IDS, type PlayerState, type PublicState, type TeamId } from "../shared/types.js";
import { cardColors, teamColor } from "./colors.js";
import { modeSelector, teamEditor } from "./lobby.js";
import { clearToken, loadToken, request, saveToken, socket } from "./net.js";
import { aiThoughtBox, closeDialog, confirmDialog, errorPage, gearButton, h, mount, run, teamLabel, toast } from "./ui.js";

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
    modeSelector(state),
    h(
      "p",
      { class: "hint" },
      TEAM_IDS.every((t) => state.connected[t])
        ? "Alle bereit. Das Spiel wird am Screen gestartet."
        : "Warte auf den zweiten Vorgeber …",
    ),
  );
}

// Entwurf des Hinweises, damit ein Live-Update Wort und Zahl nicht zurücksetzt.
let clueWord = "";
let clueNumber = MIN_CLUE_NUMBER;

/** Eingabe für Hinweis und Zahl im KI-Modus. */
function clueForm(): HTMLElement {
  const word = h("input", {
    class: "clue-input",
    type: "text",
    maxLength: MAX_CLUE_LENGTH,
    placeholder: "Hinweiswort",
    autocomplete: "off",
    "aria-label": "Hinweiswort",
    "data-key": "clue-word",
    value: clueWord,
    oninput: (e: Event) => (clueWord = (e.target as HTMLInputElement).value),
  });
  const number = h(
    "select",
    {
      class: "select clue-number-select",
      "aria-label": "Anzahl Wörter",
      onchange: (e: Event) => (clueNumber = Number((e.target as HTMLSelectElement).value)),
    },
    ...Array.from({ length: MAX_CLUE_NUMBER - MIN_CLUE_NUMBER + 1 }, (_, i) => {
      const n = MIN_CLUE_NUMBER + i;
      return h("option", { value: String(n), selected: n === clueNumber }, String(n));
    }),
  );
  return h(
    "form",
    {
      class: "clue-form",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (await run({ type: "giveClue", word: clueWord, number: clueNumber })) {
          clueWord = "";
          clueNumber = MIN_CLUE_NUMBER;
        }
      },
    },
    word,
    number,
    h("button", { class: "btn primary", type: "submit" }, "Hinweis abgeben"),
  );
}

/** Hinweis-Bereich im KI-Modus: Eingabe, aktueller Hinweis oder Warten. */
function cluePanel(state: PlayerState, myTurn: boolean): HTMLElement {
  const clue = state.currentClue;
  if (clue) {
    return h(
      "div",
      { class: "clue-current" },
      "Hinweis: ",
      h("strong", {}, `${clue.word} ${clue.number}`),
      ` · Versuche: ${clue.guesses.length} / ${clue.number + 1}`,
    );
  }
  if (myTurn && !state.aiThinking) return clueForm();
  return h("div", { class: "clue-current" }, "Warte auf ", teamLabel(state, state.currentTeam));
}

function gameView(state: PlayerState): HTMLElement {
  const myTurn = state.phase === "playing" && state.currentTeam === state.team;
  const aiMode = state.mode === "ai";
  // Im KI-Modus deckt die KI auf, der Vorgeber gibt nur den Hinweis.
  const canReveal = myTurn && !aiMode;
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
          disabled: !canReveal || card.revealed,
          tabIndex: aiMode ? -1 : 0,
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

  const endTurn =
    !aiMode &&
    h(
    "button",
    {
      class: "btn primary big end-turn",
      disabled: !canReveal,
      onclick: async () => {
        if (await confirmDialog("Zug beenden?", "Das andere Team ist dann am Zug.", "Zug beenden")) {
          await run({ type: "endTurn" });
        }
      },
    },
      "Zug beenden",
    );

  return h(
    "div",
    { class: `player-game phase-${state.phase}` },
    status,
    aiMode && state.phase !== "finished" && cluePanel(state, myTurn),
    aiThoughtBox(state),
    grid,
    remaining,
    endTurn,
  );
}
