import type { components } from "./generated/api";
export type Npc = "sun" | "li" | "zhang";
export type Action = components["schemas"]["TurnInput"]["action"];
export type GameState = components["schemas"]["GameState"];
export interface Save {
  id: string;
  version: number;
  state: GameState;
}
export interface Story {
  title: string;
  subtitle: string;
  acts: { title: string; location: string; time: string; intro: string }[];
  npcs: Record<Npc, { name: string; role: string }>;
  tips: { title: string; text: string; source: string }[];
}
export interface GameEvent {
  act?: number;
  id: string;
  kind: string;
  text: string;
  npc: Npc;
  action?: string;
}
export interface Result {
  status: string;
  text?: string;
  save?: Save;
  turn_id: string;
  retryable?: boolean;
}
