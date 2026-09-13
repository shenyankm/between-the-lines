"""The one authored story, with an explicit public projection."""

from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field, model_validator

from .game_types import Action, GameState, GameStateV2, Npc


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
    story_version: int = 1
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: PublicNpcs
    tips: list[Tip]
    adaptation_note: str
    wang_reply: str


class StoryDefinition(BaseModel):
    story_version: int = 1
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
            story_version=self.story_version,
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
            if state.act >= 3 and not isinstance(state, GameStateV2):
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
        if isinstance(state, GameStateV2):
            for relation in result:
                if relation.id == "xie" and state.partner_choice == "distance":
                    relation.description = (
                        "你已明确边界，暂时保持距离。尚未决定分手，也没有承诺和好。"
                    )
        return result

    def greeting_for(self, npc: Npc, act: int, flags: list[str]) -> str:
        character = self.npcs[npc]
        keys = (
            ["sun_cut", "sun_observe"]
            + (["boundary"] if act == 1 or self.story_version == 2 else [])
            if npc == "sun"
            else ["delivered", "supported", "reported"]
            if npc == "zhang"
            else []
        )
        key = next((key for key in keys if key in flags), str(act))
        return character.greetings.get(key, character.greetings.get(str(act), character.greeting))

    def scene_intro(self, state: GameState) -> str:
        intro = self.acts[state.act].intro
        if not isinstance(state, GameStateV2):
            return intro
        flags = set(state.flags)
        if state.act == 2:
            if "boundary" in flags:
                intro += "孙淼开始把话题限定在工作事项上，之前表达的边界仍然有效。"
            if "confronted" in flags:
                intro += "上次公开争议仍受同事关注；通知责任尚需核对，不能凭猜测认定。"
            if "wang_contacted" in flags:
                intro += "想到王叔的私人回信，你知道仍有一段支持关系可以珍惜。"
        if state.act == 3:
            if "notice_checked" in flags:
                intro += "你已核对通知记录，未查明的责任如实保留。"
            if "joint_review" in flags:
                intro += "张工协调、李姐审核的联合沟通已经结束，采购进展有记录可查。"
            elif "supported" in flags:
                intro += "张工已明确支持项目，后续风险可以继续向他同步。"
            if state.partner_choice == "distance":
                intro += "工作之外，你与谢川暂时保持距离；这不意味着和好。"
            elif state.partner_choice == "breakup":
                intro += "工作之外，你已经结束与谢川的关系，把决定权留给自己。"
        return intro

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
        details = [
            text
            for flag, text in self.ending_details.items()
            if flag in flags
            and not (isinstance(state, GameStateV2) and flag == "personal_resolved")
        ]
        if isinstance(state, GameStateV2) and state.partner_choice:
            details.append(
                "你与谢川已经分手，珍惜家人的关爱，也保留生活自主权。"
                if state.partner_choice == "breakup"
                else "你与谢川暂时保持距离，未来如何选择仍由你决定。"
            )
        return "".join([self.endings[key], *details])


@lru_cache(maxsize=2)
def load_story(version: int = 1) -> StoryDefinition:
    if version not in (1, 2):
        raise ValueError("Unsupported story version")
    return StoryDefinition.model_validate_json(
        Path(__file__).with_name("story-v2.json" if version == 2 else "story.json").read_text()
    )
