"""The one authored story, with an explicit public projection."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

from .game_types import Action, GameState, GameStateV2, GameStateV3, Npc


class Choice(BaseModel):
    label: str
    action: Action
    target: Npc | None = None
    entry: Literal["phone", "work"] | None = None


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


class SceneLine(BaseModel):
    id: str
    speaker: str
    text: str
    portraits: list[str] = Field(default_factory=list)
    location: str | None = None
    background: str | None = None


class PublicNpcs(BaseModel):
    sun: PublicNpc
    li: PublicNpc
    zhang: PublicNpc
    wang: PublicNpc | None = None


class Relationship(BaseModel):
    id: str
    name: str
    role: str
    description: str
    evidence_event_ids: list[str] = Field(default_factory=list)


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
    scenes: dict[str, list[SceneLine]] = Field(default_factory=dict)
    wang_reply: str


class StoryDefinition(BaseModel):
    story_version: int = 1
    player_name: str = "周凌"
    title: str
    subtitle: str
    acts: list[Act] = Field(min_length=5, max_length=5)
    npcs: dict[Npc, PrivateNpc]
    tips: list[Tip]
    adaptation_note: str
    scenes: dict[str, list[SceneLine]] = Field(default_factory=dict)
    wang_reply: str
    relationships: list[RelationshipDefinition]
    endings: dict[str, str]
    ending_details: dict[str, str]
    relationship_actions: dict[str, str]

    @model_validator(mode="after")
    def references(self) -> Self:
        if set(self.npcs) != (
            {"sun", "li", "zhang", "wang"} if self.story_version == 3 else {"sun", "li", "zhang"}
        ):
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
            scenes=self.scenes,
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

    def performance_for(self, state: GameState) -> list[SceneLine]:
        if not isinstance(state, GameStateV3):
            return []
        lines = [line.model_copy(deep=True) for line in self.scenes.get(state.node, [])]
        if state.content_revision < 2:
            return lines
        for line in lines:
            if line.id == "act_3-opening-0" and "purchase_approved" in state.work.facts:
                line.text = "采购申请已经通过，办公室里却出现了新的传言。"
            if line.id == "act_3-opening-3":
                # Reading a scripted line must not promise delivery or choose a career path.
                line.text = (
                    "项目已经交付，我会把交付记录整理给你。"
                    if "delivered" in state.work.facts
                    else "我会把当前项目进度和需要协调的问题整理给你。"
                ) + "\n整理工作记录并不代表决定跳槽。关于去留，请以我自己的说明为准。"
        return lines

    def narrative_flags(self, state: GameState) -> set[str]:
        if isinstance(state, GameStateV3):
            return set(state.flags)
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
        if isinstance(state, GameStateV3):
            work, relations = state.work.facts, state.relationship.facts
            work_keys = {
                "sun": {"purchase_submitted", "requirements", "responsibility", "rules_changed"},
                "li": {
                    "return_disputed",
                    "purchase_approved",
                    "responsibility",
                    "rules_proposed",
                    "rules_changed",
                    "rumor_verified",
                },
                "zhang": {
                    "reported",
                    "supported",
                    "delivered",
                    "extension",
                    "career_loss",
                    "loss_corrected",
                    "helped",
                },
                "wang": {"wang_contacted"},
            }
            for relation in result:
                evidence = [
                    fact.event_id
                    for key, fact in work.items()
                    if key in work_keys.get(relation.id, set())
                ]
                if relation.id == "sun":
                    evidence += [
                        fact.event_id
                        for key, fact in relations.items()
                        if not key.startswith("partner_") and key != "wang_contacted"
                    ]
                    if state.relationship.intention == "professional":
                        relation.description = "你明确选择职业关系。" + (
                            "后续协作已按边界执行。"
                            if "follow_up" in relations
                            else "后续执行仍待验证。"
                        )
                    elif state.relationship.intention == "friendship":
                        relation.description = (
                            "你希望保留友谊。"
                            + (
                                "双方已表达修复意愿。"
                                if "friendship" in relations
                                else "对方尚未回应。"
                            )
                            + (
                                "补救与后续尊重均已记录。"
                                if {"remedy", "follow_up"} <= relations.keys()
                                else "具体补救或后续执行仍未完成。"
                            )
                        )
                    else:
                        relation.description = "你尚未决定私人关系，工作合作仍按职责进行。"
                elif relation.id == "wang":
                    evidence += [
                        fact.event_id for key, fact in relations.items() if key == "wang_contacted"
                    ]
                    relation.description = "退休前辈，可提供流程经验与建议，无最终审批权。" + (
                        "你已主动联系。" if evidence else "尚无本局联系记录。"
                    )
                relation.evidence_event_ids = list(dict.fromkeys(evidence))
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
        if isinstance(state, GameStateV3):
            return "；".join(
                [
                    state.ending,
                    *(
                        state.outcome.achievements + state.outcome.unresolved
                        if state.outcome
                        else []
                    ),
                ]
            )
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


@lru_cache(maxsize=6)
def load_story(version: int = 1, revision: int = 2) -> StoryDefinition:
    if version not in (1, 2, 3):
        raise ValueError("Unsupported story version")
    if revision not in (1, 2):
        raise ValueError("Unsupported content revision")
    filename = (
        "story-v3-r1.json"
        if version == 3 and revision == 1
        else (f"story-v{version}.json" if version >= 2 else "story.json")
    )
    return StoryDefinition.model_validate_json(Path(__file__).with_name(filename).read_text())
