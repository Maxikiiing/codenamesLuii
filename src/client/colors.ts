import type { CardType, PaletteColor, TeamConfig, TeamId } from "../shared/types.js";

export const PALETTE_COLORS: Record<PaletteColor, { label: string; bg: string; fg: string }> = {
  red: { label: "Rot", bg: "#d33a3a", fg: "#ffffff" },
  blue: { label: "Blau", bg: "#2f6bd6", fg: "#ffffff" },
  green: { label: "Grün", bg: "#2b9a4b", fg: "#ffffff" },
  purple: { label: "Lila", bg: "#8848cf", fg: "#ffffff" },
  orange: { label: "Orange", bg: "#f08a1c", fg: "#1d1d1d" },
  pink: { label: "Pink", bg: "#e2559b", fg: "#ffffff" },
  teal: { label: "Türkis", bg: "#17a3a3", fg: "#ffffff" },
  yellow: { label: "Gelb", bg: "#f3c614", fg: "#1d1d1d" },
};

export const NEUTRAL_COLOR = { bg: "#e3d3b0", fg: "#3a3226" };
export const ASSASSIN_COLOR = { bg: "#141414", fg: "#ffffff" };

export function cardColors(type: CardType, teams: Record<TeamId, TeamConfig>): { bg: string; fg: string } {
  if (type === "neutral") return NEUTRAL_COLOR;
  if (type === "assassin") return ASSASSIN_COLOR;
  return PALETTE_COLORS[teams[type].color];
}

export const teamColor = (teams: Record<TeamId, TeamConfig>, team: TeamId) => PALETTE_COLORS[teams[team].color];
