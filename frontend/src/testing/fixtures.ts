import type { components } from "../generated/api";
import type { GameEvent, Save, Story } from "../types";

/** Request body the backend accepts for `POST /api/saves/{id}/turns`. */
export type TurnInput = components["schemas"]["TurnInput"];

type GameState = Save["state"];

/**
 * Mirrors `backend/app/story.json`: five acts (prologue plus four), three
 * interlocutors and editor tips. Act titles keep the ` · ` separator that
 * `Play` splits on when it renders the chapter navigation.
 */
import authored from "./story.json";
export const story = authored as Story;

function gameState(over: Partial<GameState> = {}): GameState {
  return {
    act: 1,
    credit: 60,
    stress: 20,
    heat: 10,
    flags: [],
    procurement: "pending",
    ending: null,
    ...over,
  };
}

export function save(
  over: { id?: string; version?: number; state?: Partial<GameState> } = {},
): Save {
  return {
    id: over.id ?? "save-1",
    version: over.version ?? 2,
    state: gameState(over.state),
  };
}

/** An NPC reply in the act the default save sits in. */
export const sunReply: GameEvent = {
  id: "evt-1",
  kind: "npc",
  npc: "sun",
  act: 1,
  text: "菱菱，你不会又生气了吧？我只是随口一说。",
};

/** Same interlocutor, earlier act: must not be picked as the latest reply. */
export const olderSunReply: GameEvent = {
  id: "evt-0",
  kind: "npc",
  npc: "sun",
  act: 0,
  text: "这句是上一幕的旧回复。",
};

export const epilogueEvent: GameEvent = {
  id: "evt-9",
  kind: "epilogue",
  npc: "sun",
  text: "你为这段经历选择了一条清晰的边界。",
};
