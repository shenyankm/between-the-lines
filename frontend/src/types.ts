import type { components } from "./generated/api";
type Schema = components["schemas"];
export type TurnInput = Schema["TurnInput"];
export type Npc = NonNullable<TurnInput["npc"]>;
export type Action = NonNullable<TurnInput["action"]>;
export type GameState = Schema["GameState"];
export type Save = Schema["SaveOut"];
export type Story = Schema["StoryOut"];
export type GameEvent = Schema["GameEventOut"];
export type Result = Schema["TurnResult"];
export type PlayState = Schema["PlayStateOut"];
export type Turn = Schema["TurnOut"];
export type User = Schema["UserOut"];
export type Config = Schema["ConfigOut"];
export type Interlude = Schema["Interlude"];

export type ErrorCode = Schema["ErrorCode"];
