"""Clearly labelled design fixtures; never presented as retrieved Zhihu content."""

from typing import Any

VIEWS = {
    1: [
        ("关系再好，也不该替你做决定。", "我愿意自己决定是否参加，下次请直接问我。"),
        (
            "把感受说清楚，也给对方回应的机会。",
            "没收到通知让我有些失落，我想听听当时是怎么安排的。",
        ),
        ("不急着定义关系，先看后续行动。", "这次我先保留自己的想法，之后的安排请正常通知我。"),
    ],
    2: [
        ("先问清具体标准，再修改材料。", "请指出哪项材料不符合哪条要求，我按具体依据补充。"),
        (
            "让流程负责人共同核对，留下记录。",
            "我们请财务和研发一起核对模板，并在系统里记录处理意见。",
        ),
        ("先确认影响和期限，避免反复返工。", "我先列出待确认项和交付节点，确认后再修改。"),
    ],
    3: [
        ("针对传言澄清事实，不替别人猜动机。", "关于我准备跳槽的说法并不准确，请不要继续传播。"),
        ("在传言出现的渠道留下明确说明。", "我想在工作群里说明事实，也请转述过的人同步更正。"),
        ("保留边界，关注澄清后的实际变化。", "我的私人安排由我说明，请先把注意力放回工作。"),
    ],
}


def discussion_mock(act: int) -> dict[str, Any]:
    rows = VIEWS.get(act, VIEWS[1])
    return {
        "label": "Mock 展示 · 示例观点与赞同数，非真实知乎检索",
        "mock": True,
        "highlight": "总的来说她又对我不错" if act == 1 else rows[0][0],
        "highlight_votes": 2341,
        "cards": [
            {
                "id": f"mock-{act}-{index}",
                "view": view,
                "situation": [
                    "希望直接表达边界时",
                    "需要核对信息、协调处理时",
                    "暂时不想立即作出关系决定时",
                ][index],
                "expression": expression,
                "possible_cost": [
                    "可能需要进一步解释。",
                    "需要更多沟通时间。",
                    "问题可能暂时仍未解决。",
                ][index],
                "sources": [],
            }
            for index, (view, expression) in enumerate(rows)
        ],
    }
