"""The one authored story, with an explicit public projection."""

from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field, model_validator

from .game_types import Action, GameState, Npc


class Choice(BaseModel):
    label: str
    action: Action
    target: Npc | None = None


class Interlude(BaseModel):
    image: str
    location: str
    time: str
    text: str


class Act(BaseModel):
    title: str
    chapter_title: str
    location: str
    time: str
    intro: str
    background: str
    choices: list[Choice]
    interlude: Interlude | None = None


class PublicNpc(BaseModel):
    name: str
    role: str
    portrait: str
    color: str
    greeting: str


class PrivateNpc(PublicNpc):
    persona: str
    greetings: dict[str, str] = Field(default_factory=dict)


class Tip(BaseModel):
    title: str
    text: str
    source: str


class PublicNpcs(BaseModel):
    sun: PublicNpc
    li: PublicNpc
    zhang: PublicNpc


class Relationship(BaseModel):
    id: str
    name: str
    role: str
    description: str


class RelationshipDefinition(Relationship):
    updates: dict[str, str] = Field(default_factory=dict)


class StoryOut(BaseModel):
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: PublicNpcs
    tips: list[Tip]
    adaptation_note: str
    wang_reply: str


class StoryDefinition(BaseModel):
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: dict[Npc, PrivateNpc]
    tips: list[Tip]
    adaptation_note: str
    wang_reply: str
    relationships: list[RelationshipDefinition]
    endings: dict[str, str]
    ending_details: dict[str, str]
    relationship_actions: dict[str, str]

    @model_validator(mode="after")
    def references(self) -> Self:
        if set(self.npcs) != {"sun", "li", "zhang"}:
            raise ValueError("The story requires its three NPCs")
        for asset in self.assets():
            if not asset.startswith("/assets/") or ".." in asset or "\\" in asset:
                raise ValueError(f"Invalid story asset: {asset}")
        return self

    def assets(self) -> list[str]:
        return (
            [act.background for act in self.acts]
            + [act.interlude.image for act in self.acts if act.interlude]
            + [npc.portrait for npc in self.npcs.values()]
        )

    def public(self) -> StoryOut:
        return StoryOut(
            title=self.title,
            subtitle=self.subtitle,
            acts=self.acts,
            npcs=PublicNpcs.model_validate(
                {
                    key: PublicNpc.model_validate(value.model_dump(exclude={"persona"}))
                    for key, value in self.npcs.items()
                }
            ),
            tips=self.tips,
            adaptation_note=self.adaptation_note,
            wang_reply=self.wang_reply,
        )

    def narrative_flags(self, state: GameState) -> set[str]:
        flags = set(state.flags)
        # Unfinished v1 saves adopt the narrative of their current act. Ended
        # saves never acquire events just because their terminal act is 4.
        if not state.ending:
            if state.act >= 2:
                flags.add("reflection")
            if state.act >= 3:
                flags.add("personal_resolved")
        if state.procurement == "approved":
            flags.add("purchase_approved")
        if state.act == 3 or "personal_resolved" in flags:
            flags.add("rumor_scene")
        return flags

    def relationships_for(self, state: GameState) -> list[Relationship]:
        flags = self.narrative_flags(state)
        result = []
        for person in self.relationships:
            description = person.description
            for flag, text in person.updates.items():
                if flag in flags:
                    description = text
            result.append(
                Relationship(
                    id=person.id, name=person.name, role=person.role, description=description
                )
            )
        return result

    def greeting_for(self, npc: Npc, act: int, flags: list[str]) -> str:
        character = self.npcs[npc]
        keys = (
            ["sun_cut", "sun_observe"] + (["boundary"] if act == 1 else [])
            if npc == "sun"
            else ["delivered", "supported", "reported"]
            if npc == "zhang"
            else []
        )
        key = next((key for key in keys if key in flags), str(act))
        return character.greetings.get(key, character.greetings.get(str(act), character.greeting))

    def ending_summary(self, state: GameState) -> str | None:
        if not state.ending:
            return None
        flags = set(state.flags)
        if "relationship_story" not in flags:
            return self.endings["legacy"]
        key = (
            "leave"
            if state.ending == "主动离开"
            else ("cut_ties" if "sun_cut" in flags else "keep_distance")
        )
        details = [text for flag, text in self.ending_details.items() if flag in flags]
        return "".join([self.endings[key], *details])


@lru_cache(maxsize=1)
def load_story() -> StoryDefinition:
    return StoryDefinition.model_validate_json(Path(__file__).with_name("story.json").read_text())
