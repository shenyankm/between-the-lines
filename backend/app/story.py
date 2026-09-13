"""The one authored story, with an explicit public projection."""

from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field, model_validator

from .game_types import Action, Npc


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
    scene_notes: dict[str, str] = Field(default_factory=dict)


class Tip(BaseModel):
    title: str
    text: str
    source: str


class PublicNpcs(BaseModel):
    sun: PublicNpc
    li: PublicNpc
    zhang: PublicNpc


class CommunityView(BaseModel):
    title: str
    text: str
    author: str
    source_title: str
    url: str
    act: int
    provenance: str = "根据知乎开放平台搜索摘要整理，非作者原话；仅供比较，不是标准答案。"
    retrieved: str = "2026-09-13"


class StoryOut(BaseModel):
    community: list[CommunityView] = Field(default_factory=list)
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: PublicNpcs
    tips: list[Tip]


class StoryDefinition(BaseModel):
    community: list[CommunityView] = Field(default_factory=list)
    world: str = ""
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: dict[Npc, PrivateNpc]
    tips: list[Tip]

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
                    key: PublicNpc.model_validate(
                        value.model_dump(exclude={"persona", "scene_notes"})
                    )
                    for key, value in self.npcs.items()
                }
            ),
            tips=self.tips,
            community=self.community,
        )


def load_story() -> StoryDefinition:
    return StoryDefinition.model_validate_json(Path(__file__).with_name("story.json").read_text())
