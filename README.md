# 言外之意 · Between the Lines

一款以职场关系与边界为主题的中文互动小说。玩家扮演研发专员周凌，在欢送会排挤、采购受阻和跳槽传言中调查事实、选择处理方式，并留下自己的选择理由。

**AI 负责角色对白和结局回顾；游戏后端负责事实、权限与剧情进度。** 三名可交互 NPC 是孙淼、李姐和张工。自由聊天使用 Deep Agents + LangGraph，支持 OpenAI 兼容服务、DeepSeek，以及无需密钥的模拟模式。

- [启动项目](#启动项目)
- [接入真实 AI](#接入真实-ai)
- [AI 如何参与游戏](#ai-如何参与游戏)
- [修改人设与世界观](#修改人设与世界观)
- [验证接入是否成功](#验证接入是否成功)
- [玩法与当前限制](#玩法与当前限制)
- [测试与项目结构](#测试与项目结构)

## 启动项目

需要 **Python 3.13、Node.js 22.23.2+、Corepack、PostgreSQL 17**。前端锁定 pnpm 11.19.0，命令须从 `frontend/` 执行，让 Corepack 读取正确版本。本项目使用已有 Miniconda Python，不创建新虚拟环境。

### 1. 安装依赖并启动数据库

以下使用 Docker 启动本地数据库；也可以使用已有 PostgreSQL，设置对应连接地址。

```sh
conda activate base
python --version  # 应为 3.13.x
python -m pip install uv
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock

test -f .env || cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up -d db
```

### 2. 配置并运行后端

新建 **`backend/.env`**，先用模拟模式验证安装：

```dotenv
ENVIRONMENT=development
AGENT_MODE=mock
DEV_LOGIN_ENABLED=true
DATABASE_URL=postgresql+asyncpg://btl:btl@127.0.0.1:54329/btl
CHECKPOINT_URL=postgresql://btl:btl@127.0.0.1:54329/btl
PUBLIC_ORIGIN=http://localhost:5173
```

```sh
cd backend
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

配置读取优先级为：**进程环境变量 > `backend/.env` > 根目录 `.env` > 默认值**。根目录 `.env.example` 用于 Compose，里面的 `db:5432` 只适用于容器网络，本机 Python 应使用上述本地地址。

### 3. 运行前端

另开终端：

```sh
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

打开 [localhost:5173](http://localhost:5173)，选择“开发环境试玩”，创建存档。前端经 Vite 代理访问 `127.0.0.1:8000`；其他后端地址可通过 `BTL_API_TARGET` 设置。

若改用 `5174` 等端口，请同时修改后端 `PUBLIC_ORIGIN` 并重启。开发登录每次创建独立身份，刷新保留登录；退出后重新开发登录不会找回旧身份。

## 接入真实 AI

**前端不需要填写密钥，也不直接请求模型。** 只需配置后端的供应商参数并重启，原有对话页面就会使用真实 AI。

### OpenAI 或 OpenAI 兼容服务

在 `backend/.env` 保留数据库等配置，将模型部分改为：

```dotenv
AGENT_MODE=openai
OPENAI_API_KEY=在这里填写对应服务的密钥
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-6-astra
```

上面是官方 API 地址。**当前试玩版本实际联调使用的是第三方 OpenAI Next**，对应配置为：

```dotenv
AGENT_MODE=openai
OPENAI_API_KEY=在这里填写OpenAI-Next的密钥
OPENAI_BASE_URL=https://api.openai-next.com/v1
OPENAI_MODEL=gpt-6-astra
```

密钥必须与所选服务匹配，模型名以该服务实际可用列表为准。第三方兼容服务不是官方 OpenAI API。仓库没有附带真实密钥；`.env` 与 `backend/.env` 均被 Git 忽略，不要将密钥放进 `VITE_*` 变量或前端源码。

当前适配逻辑位于 [`make_model()`](backend/app/agents.py)：

| 配置 | 调用方式 | 说明 |
|---|---|---|
| `AGENT_MODE=openai`，模型名以 `gpt-5` / `gpt-6` 开头 | `ChatOpenAI` → Responses API | 低推理强度，不发送 `temperature`；要求服务支持 Responses 和工具调用 |
| `AGENT_MODE=openai`，其他模型名 | `ChatOpenAI` → Chat Completions | 使用常规采样参数；默认配置模型为 `gpt-4.1-mini` |
| `AGENT_MODE=deepseek` | `ChatDeepSeek` → DeepSeek | 使用 `deepseek-flash`，关闭 thinking |
| `AGENT_MODE=mock` | 本地 HTTPX 模拟返回 | 无外部模型请求，用于安装检查、自动化测试 |

模型前缀只是当前项目的适配约定，不代表任意未来模型都兼容。更换供应商或模型后，务必验证普通对白、工具调用与流式返回。失败时不会自动切换供应商。

停止旧的 Uvicorn 进程后重新执行启动命令。如果之前通过 `AGENT_MODE=mock python ...` 启动，请去掉这个环境变量覆盖，否则修改 `.env` 不会生效；`make api` 也明确启动 mock 模式。

### DeepSeek

```dotenv
AGENT_MODE=deepseek
DEEPSEEK_API_KEY=在这里填写DeepSeek密钥
DEEPSEEK_API_BASE=https://api.deepseek.com
```

上述三种模式共用剧情规则、存档、角色权限和回合恢复机制。模拟模式的自由对白仍经过 Agent 工具循环和检查点，**模拟通关不等于真实模型质量验收**。

### 用量与超时

`DAILY_TURN_LIMIT`、`MAX_CONCURRENT_TURNS`、`TURN_TIMEOUT_SECONDS`、`MAX_MODEL_CALLS` 和 `MAX_TOOL_CALLS` 控制回合额度与执行预算，默认分别为 100、30、60 秒、4、6。

使用 OpenAI 兼容服务时，可按供应商实际价格配置 `OPENAI_INPUT_USD_PER_MILLION`、`OPENAI_OUTPUT_USD_PER_MILLION`。未配置价格时仍记录 Token，但费用估算为 `null`，不会套用 DeepSeek 价格。设置月度费用上限 `MONTHLY_COST_CAP_USD` 前必须配置价格；最终费用以供应商账单为准。

## AI 如何参与游戏

### 一次自由对话经过哪些步骤

1. 前端提交玩家发言、目标 NPC、存档版本和唯一请求编号。
2. 后端检查登录身份、存档归属、并发、额度与版本，保存玩家这次发言。
3. `context_for()` 读取该 NPC 可见的最新游戏事实、已解锁记录、历史对白和长期记忆。
4. `AgentGateway` 将**世界观 + 当前 NPC 人设 + 当前幕次处境 + 角色可见上下文**传给模型。
5. 模型生成对白，必要时请求游戏工具；工具由后端校验并执行，模型不能自行宣告剧情状态改变。
6. 可公开的对白通过 SSE 展示；回复完成后保存最终文本与用量。重复请求不会重复执行行动，断线后可恢复同一回合。

负责调度的 [`runner.py`](backend/app/runner.py) 独立于浏览器连接运行。流式预览只展示供应商明确标记为 `final_answer` 的文本；推理、commentary 和工具参数不进入预览。不提供该标记的服务会等待完整对白。未完成回复不保存为完整 NPC 发言。

### NPC 可以调用什么工具

| 工具 | 用途 | 后端约束 |
|---|---|---|
| `inspect_work` | 读取角色可见的工作状态 | 不读取其他人的私聊 |
| `act_on_work` | 明确材料要求、审核采购、落实研发支持 | 材料与幕次满足后才能执行；李姐审核、张工支持，孙淼没有最终审批权 |
| `propose_action` | 将玩家明确意愿转成待确认行动 | 只提出建议，玩家点击确认后才改变剧情 |
| `remember_player` | 保存长期偏好或关系边界 | 最多 240 字，必须逐字来自本轮玩家发言 |

模型不拥有执行命令、访问文件或创建子 Agent 的工具。行动结果以 [`domain.py`](backend/app/domain.py) 和 [`investigation.py`](backend/app/investigation.py) 的规则为准；数据库写入、权限、重复操作保护由 [`services.py`](backend/app/services.py) 执行。

### 人物记忆如何保留

记忆保存在 PostgreSQL 的事件记录中，不依赖浏览器缓存。每轮注入最近 **24 条重要原话、16 条已确认行动、30 条角色可见事件**，并附上当前关系与获准使用的调查记录。玩家说“我准备公开”不会被当作“已经公开”。

每名 NPC 的检查点按 `用户 ID : 存档 ID : NPC` 隔离。模型 HTTP 连接在应用生命周期内复用，但不同玩家的提示词、历史和检查点不共用。私下取得的记录不会自动传给其他角色；公开选择只公开指定的材料。

### 哪些回复不会等待 AI

| 场景 | 实现 |
|---|---|
| 自由聊天、复杂追问 | 配置的角色模型 |
| 固定剧情选择、调查按钮 | [`reactions.py`](backend/app/reactions.py) 的角色回应与后端规则，零模型调用 |
| 明确询问材料、请李姐审核、请张工落实支持 | [`fast_work.py`](backend/app/fast_work.py) 识别完整短句，校验并保存后直接回复 |
| 王会计祝福回信 | 已编写的私人回信 |
| 结局回顾 | AI 根据已确定结局、实际后果和玩家理由生成，不能改变结局 |

第二幕有三个快捷工作入口。快速执行只匹配完整明确的短句，不凭关键词执行“不要审核”“如果审核”“他说请审核”等否定、条件或引用表达；未匹配的内容继续交给角色 AI。

**延迟实测（2026-09-13，本机小样本）**：同一组材料询问、审核、排期支持从完整回复 5.7–8.4 秒降到 13–16 毫秒；手机浏览器点击到显示回复约 113 毫秒。自由对白首段仍约 2.6–4.2 秒，本轮没有证明稳定提速，也不承诺供应商始终达到该速度。优化思路参考 [OpenAI 延迟优化指南](https://developers.openai.com/api/docs/guides/latency-optimization)。

## 修改人设与世界观

编辑 [`backend/app/story.json`](backend/app/story.json)，然后重启后端：

- `world`：公司背景、玩家身份、人物关系和统一的知识边界。
- `npcs.sun / li / zhang.persona`：角色性格、动机、说话方式与权限。
- `npcs.*.scene_notes`：按幕次编号填写该角色当前处境；模型只拿到当前幕次。
- `acts`：玩家可见的场景、介绍、选项和幕间内容。
- `community`：有来源链接的知乎观点摘要，与虚构调查材料分别展示。

例如，孙淼应以亲昵和流程掩饰推责，不因熟悉度上升就突然悔改；李姐会调停但不要求玩家道歉才能审批；张工按事实保护专业工作。周凌的选择与内心结论由玩家决定。

**只改提示词不能增加真实玩法。** 要增加可以改变剧情的行动，需要同步更新 `game_types.py`、领域规则、回应与前端交互，再重新生成接口契约。角色私有人设和 `scene_notes` 不通过公开故事接口发送给浏览器。

## 验证接入是否成功

1. 访问 `GET /api/config`：真实接入应显示 `agent_mode: "openai"`（或 `deepseek`）、`model_ready: true`。这仅证明配置齐备，不证明密钥有效。
2. 新建存档并进入第一幕，用自己的话问 NPC 一个问题，确认实际生成对白；固定按钮零模型调用，不能用它判断 AI 是否连通。
3. 在第二幕输入更具体的采购追问，检查材料要求是否登记、材料不足时是否拒绝审批、孙淼是否无法代替李姐审核。
4. 提出明确的关系边界，确认待执行建议与记忆记录正确；切换 NPC，检查私聊没有串入其他人的上下文。
5. 查看登录状态下的 `GET /api/saves/{save_id}/turns/{request_id}`：包含模型、调用次数、Token、耗时、首段时间和结果。请求编号就是提交回合时的 `request_id`。

| 问题 | 优先检查 |
|---|---|
| 始终是模拟回复 | 进程是否仍设置 `AGENT_MODE=mock`，修改后是否重启 |
| 配置显示 ready，但对话失败 | 密钥与地址是否对应、模型是否可用、账户额度与网关响应 |
| 普通聊天可以，工具失败 | 所选模型和兼容网关是否支持项目使用的 Responses / 工具协议 |
| 看不到逐字显示 | 网关是否提供明确的 `final_answer` 阶段标记 |
| 浏览器请求被拒绝 | `PUBLIC_ORIGIN` 是否与实际访问地址一致 |
| AI 说审核通过，状态却未改变 | 应检查工具成功事件；后端状态才是事实，不能只看模型的说法 |

## 玩法与当前限制

现有五个阶段：序幕、欢送会、采购冲突、流言冲突、结局。第二、三幕可对照口径、取得日志和纪要，再选择私下处理或公开。关系和专业信用决定信息入口；舆论达到 60 触发协调，内耗达到 80 需休整或离开。

四项调查决策要求填写 2–500 字理由，与当时证据一起保存。结局结果卡可下载 PNG 或复制文字。旧存档新增字段有默认值，不必重置。

知乎数据与 AI、知乎 OAuth 是三套独立接入：

- **模型密钥**用于生成 NPC 对白。
- **`ZHIHU_ACCESS_SECRET`**用于开放平台数据搜索；导入程序为 `python -m app.zhihu_import`（在 `backend/` 执行）。当前四条观点来自公开搜索摘要的短篇编辑整理，注明来源、作者和日期，运行时不实时搜索。
- **知乎 OAuth**用于第三方登录，需要单独申请应用凭据与配置端点。目前未完成真实 OAuth 登录联调，不能把 Access Secret 当作 OAuth 应用密钥。

当前仍是单故事试玩：固定行动使用编写好的回应，AI 自由对话有语义和服务延迟波动；未承诺全角色、全流程都由模型生成。没有新增可交互人物，也不提供人格测评结论。

## 测试与项目结构

日常测试使用 mock 模式和独立 `btl_test` 数据库，不消耗真实模型额度。**后端测试会清空测试库数据，不要与使用同一测试库的试玩 API 同时运行。**

```sh
# 先启动本地数据库；测试库只需创建一次
# 如已存在，跳过 createdb
docker compose -f compose.yaml -f compose.dev.yaml exec -T db createdb -U btl btl_test

cd backend
DATABASE_URL=postgresql+asyncpg://btl:btl@127.0.0.1:54329/btl_test python -m alembic upgrade head
python -m pytest -q
python -m mypy app
python -m ruff check app tests migrations

cd ../frontend
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

浏览器测试需要独立的 mock API 与前端。隔离容器方式、CI、断线恢复、备份恢复和压测见 [CI 说明](docs/ci.md)。本机可使用 `BTL_API_TARGET=http://127.0.0.1:8001` 启动端口 5175 的 Vite，再执行：

```sh
# 在 frontend/ 中；mock API、Vite 需已启动
PLAYWRIGHT_BASE_URL=http://localhost:5175 corepack pnpm test:e2e
```

2026-09-13 当前分支本地验收：后端 175 项、前端 158 项、电脑与手机端到端 16 项通过，类型检查与构建通过。真实模型小样本另行验证；这些结果不代替远端 CI 或真实生产验收。

| 文件 | 职责 |
|---|---|
| `backend/app/agents.py` | 模型适配、NPC 提示词、工具、流式对白、结局生成 |
| `backend/app/context.py`、`services.py` | 角色可见上下文、记忆与存档事务 |
| `backend/app/domain.py`、`investigation.py` | 游戏规则、调查记录、关系条件与后果 |
| `backend/app/runner.py`、`routes/game.py` | 回合生命周期、SSE、断线恢复 |
| `backend/app/reactions.py`、`fast_work.py` | 固定回应与快捷工作请求 |
| `frontend/src/features/game/` | 对话、调查、结果卡与回合状态 |

修改 API 或故事公开结构后，在根目录执行 `python scripts/export-openapi.py`，再在 `frontend/` 执行 `corepack pnpm generate:api`。只读契约检查使用 `make contract`。

其他文档：[架构说明](docs/architecture.md) · [CI 与完整验证](docs/ci.md) · [部署、TLS 与备份](docs/deployment.md)。正式运行需配置 HTTPS、稳定身份登录、供应商价格与预算及备份；当前服务按单实例协调设计。
