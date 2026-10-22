// Team-Anpassung in der Lobby, genutzt von Screen (beide Teams) und Player (eigenes Team).

import { MAX_TEAM_NAME_LENGTH, otherTeam, PALETTE, type PublicState, type TeamId } from "../shared/types.js";
import { PALETTE_COLORS, teamColor } from "./colors.js";
import { h, run } from "./ui.js";

const NAME_DEBOUNCE_MS = 400;
const nameTimers: Partial<Record<TeamId, number>> = {};

function sendName(team: TeamId, input: HTMLInputElement, state: PublicState): void {
  window.clearTimeout(nameTimers[team]);
  const name = input.value.trim();
  if (!name || name === state.teams[team].name) return;
  void run({ type: "updateTeam", team, name });
}

export function teamEditor(state: PublicState, team: TeamId, editable: boolean): HTMLElement {
  const other = otherTeam(team);
  const color = teamColor(state.teams, team);
  const connected = state.connected[team];

  const status = h(
    "div",
    { class: `slot-status ${connected ? "on" : "off"}` },
    connected ? "✓ Vorgeber verbunden" : state.slots[team] ? "Vorgeber getrennt" : "Vorgeber fehlt",
  );

  if (!editable) {
    return h(
      "section",
      { class: "team-card", style: { borderColor: color.bg } },
      h("div", { class: "team-name-static", style: { background: color.bg, color: color.fg } }, state.teams[team].name),
      status,
    );
  }

  const input = h("input", {
    class: "team-name-input",
    type: "text",
    value: state.teams[team].name,
    maxLength: MAX_TEAM_NAME_LENGTH,
    "aria-label": "Teamname",
    "data-key": `team-name-${team}`,
    style: { borderColor: color.bg },
  });
  input.addEventListener("input", () => {
    window.clearTimeout(nameTimers[team]);
    nameTimers[team] = window.setTimeout(() => sendName(team, input, state), NAME_DEBOUNCE_MS);
  });
  input.addEventListener("change", () => {
    // Leeren Namen nicht stehen lassen, der Server behält den alten.
    if (!input.value.trim()) input.value = state.teams[team].name;
    sendName(team, input, state);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });

  const swatches = h(
    "div",
    { class: "swatches", role: "radiogroup", "aria-label": "Teamfarbe" },
    ...PALETTE.map((c) => {
      const taken = state.teams[other].color === c;
      const selected = state.teams[team].color === c;
      return h("button", {
        class: `swatch${selected ? " selected" : ""}`,
        style: { background: PALETTE_COLORS[c].bg },
        title: taken ? `${PALETTE_COLORS[c].label} (vom anderen Team gewählt)` : PALETTE_COLORS[c].label,
        "aria-label": PALETTE_COLORS[c].label,
        "aria-checked": String(selected),
        role: "radio",
        disabled: taken,
        onclick: () => {
          if (!selected) void run({ type: "updateTeam", team, color: c });
        },
      });
    }),
  );

  return h("section", { class: "team-card", style: { borderColor: color.bg } }, input, swatches, status);
}
