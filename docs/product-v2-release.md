# 《言外之意》v2 产品升级与发布手册

本轮保留 React、FastAPI、PostgreSQL、Deep Agents、现有 DeepSeek 配置和单 API 进程。新建故事默认 v2；原有故事继续 v1。生产上线需要另外完成真实知乎 OAuth、真实模型语义评估、机外部署和目标用户试玩，不能用 mock 测试代替。

## 实现地图

| 交付 | 主要实现 |
|---|---|
| 免费剧情行动、旧 request_id 重放、最近游玩 | `backend/app/services.py`、`routes/game.py`、`budget.py` |
| 三幕行动目录、重大选择确认、关系分支 | `actions.py`、`intents.py`、`story-v2.json`、`story.py` |
| 访客、服务端 OAuth state 绑定、延迟迁移 | `auth.py`、`product.py`、`factory.py` |
| 关键节点快照、独立重玩历史 | `services.py:capture_snapshot`、`product.py:branch_save` |
| 独立复盘和审核观点卡任务 | `jobs.py`、`content.py`、`routes/product.py` |
| 草稿、提议恢复、历史和成果卡 | `frontend/src/features/game/` |
| 图片、日志、诊断和维护 | `scripts/build-images.py`、`logging_setup.py`、`deploy/nginx*`、`scripts/product-admin.py` |
| 验收 | `backend/tests/test_product*.py`、`frontend/e2e/product-v2.spec.ts`、前端产品测试、`backend/evals/semantic-v2.json` |

规则由服务层裁决。模型不能提交任意状态；每轮最多一个普通玩家意图，NPC 后续工作操作仍检查角色权限和材料条件。公开质问、关系切割、伴侣选择、离开均先持久化提议，确认使用新 request_id。其他有效行动使旧提议失效。私聊不会自动提交实验、公开澄清、联系其他人。工具事实先提交，即使对白生成失败，事实仍保留。

v2 伴侣决定必须在第二幕工作完成后明确选择；关闭幕间不作决定。暂时保持距离不等于和好。李姐始终负责采购审核，张工只协调。通知争议只描述核实到的记录，不推断责任人。结局先确定，再单独生成复盘；AI 不可用仍能完成三幕。

## 数据版本与迁移

| 迁移 | 内容 |
|---|---|
| 0004 | 身份、访客、故事版本、last_played_at、独立 namespace、归档/回收站等基础字段；旧 namespace 回填原 user:save 标识 |
| 0005 | 提议、v2 快照、分支幂等记录、无原回合的复制历史 |
| 0006 | AI 任务、审核字段、OAuth 绑定记录、产品事件与限流、聚合 |
| 0007 | 独立 AI 费用账本，回填新任务与旧 AI 回合；删除存档后费用不会从月度预算中消失 |

迁移为增加字段/表，v1 状态 JSON 和已有回合 payload/result 不重写。老五字段输入仍按原字段比较幂等；未提供的新字段不参与旧请求比较。v1 不能中途升级，也不补造历史快照。新分支复制快照边界内的事实、对白、私人叙事，使用全新的事件 ID、历史分组和检查点 namespace；不复制原工具检查点、模型费用和节点之后的内容。父存档只是来源标识，清除父档不删除独立分支。

本地执行沿用 Miniconda，不创建虚拟环境；前端在 frontend 目录调用固定 pnpm 11.19.0：

```sh
export DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_upgrade_test_20260913
export CHECKPOINT_URL=postgresql://btl:btl@localhost:54329/btl_upgrade_test_20260913
cd backend
/Users/sheny/miniconda3/bin/python -m alembic upgrade head
/Users/sheny/miniconda3/bin/python -m alembic check
```

示例数据库必须事先创建为专用验证库。pytest、断线和重启脚本通过 `BTL_TEST_DATABASE_URL` 指定专用库；测试会清理数据，不要指向真实业务库。

## 开关与发布顺序

1. 备份数据库、检查点 schema 和应用配置，确认能恢复到独立数据库。
2. 准备支持 0004–0007 schema 的后端兼容版本；在切换应用前执行迁移，保持单实例/API 单 worker。绝不同时运行旧版不兼容写入进程。
3. 首次部署将 `STORY_V2_ENABLED=false`、`GUEST_ENABLED=false`、`AUTOMATIC_INTENTS_ENABLED=false`、`DISCUSSIONS_ENABLED=false`，检查 v1 继续和旧请求恢复。
4. 发布新前端；再逐个开启 v2 新建、自动意图、审核观点卡。访客需要真实 OAuth 联调后开放。
5. `ENVIRONMENT=production` 启动时要求完整 OAuth 配置、正式 origin、session secret，继续遵循原部署安全检查。`DEV_LOGIN_ENABLED=false`。
6. 配置 Nginx 代理私网 `TRUSTED_PROXY_NETWORKS`，例如明确的 Docker 网络 CIDR JSON 列表；API 不向公网暴露。Nginx 重写 X-Real-IP，应用只信任配置网段内的直接代理。默认空列表使用直连 IP，安全但会使代理后所有访客共用限额。
7. 按健康检查、登录、续档、三幕免费通关、查询旧终态、刷新确认卡、结果恢复顺序做机外 smoke。

关闭自动意图会回到按钮；关闭 v2 新建只禁止创建，已有 v2 仍可继续。关闭观点卡生成显示编辑建议。回退应用必须使用支持当前 schema 的兼容构建，数据库不执行破坏性 downgrade。测试迁移中的降级只用于专用空库演练。新增迁移保留，必要时前向修复。

## 身份与进度

访客 Cookie 为 HttpOnly、SameSite=Lax，生产 Secure，身份有效七天。每 IP 每小时最多五次新身份，默认八次 AI 任务，一个试玩存档（含归档和回收站）；零额度可完成第一幕行动。第二幕必须正式登录。拒绝授权不清除访客进度。

绑定来源在授权发起时写入服务端 OAuthBinding，与 Authlib state 关联；回调不根据此刻浏览器 Cookie 猜来源。绑定新老知乎账号都转移存档、回合、AI 任务及费用归属，不覆盖目标账号已有存档、不重置预算、不改变 namespace。有进行中回合或 AI 任务则等待后台处理，首页显示迁移中。重启会继续处理待迁移任务；完成后撤销访客会话。

## AI 预算与恢复

所有 AI 使用数据库事务内预占账本，全局预算通过事务锁串行受理。模型调用在事务外执行。预占基于请求 UTF-8 字节上限、输出上限、调用与重试次数；实际 HTTP 请求超过字节/次数上限直接拒绝。超时或失败时保留未确认费用，不按零释放。已知 token 费用按应用配置估算，月度统计包含旧版本已记录费用；仍需要供应商账单核对。

默认正式账号每天 100 个 AI 任务（UTC 日），访客累计八个。确定性操作不建费用账本，另受接口限流。卡片缓存命中和编辑建议不计任务额度。观点卡、复盘最多一次生成加一次结构修复。服务重启将中断的生成任务持久化为失败/未知用量并保留事实降级结果，重复 request_id 返回同一结果，不偷偷重新计费。

手工核对未知费用：准备 `[{"id":"费用账本 UUID","cost_usd":0.012}]`，先 dry-run，再显式 `--apply`。对账值必须来自供应商记录，不能按估计清零。

## 审核资料与运营命令

命令使用 `CHECKPOINT_URL` 对应的同一 PostgreSQL 数据库。必须同时设置 DATABASE_URL/CHECKPOINT_URL，避免误连默认库。现有资料导入保留候选状态；游戏运行不联网搜资料。

```sh
python scripts/product-admin.py review-export --file candidates.json
# 人工核对原文、适用幕次 topics（act_1/act_2/act_3）、标题、作者和来源。
# 修改 review_status 为 approved/rejected，填写 review_note，在 topics 追加 act_1/act_2/act_3。
# 不要改导出的 content_hash；服务端验证原内容后为已审核主题重新计算哈希。
python scripts/product-admin.py review-import --file candidates.json
python scripts/product-admin.py review-import --file candidates.json --apply
python scripts/product-admin.py metrics
python scripts/product-admin.py reconcile --file verified-costs.json
python scripts/product-admin.py reconcile --file verified-costs.json --apply
python scripts/product-admin.py cleanup
python scripts/product-admin.py cleanup --apply
```

资料内容发生变化后旧 hash 不能通过审核导入；需要重新导出审核。卡片缓存按故事版本、幕次、资料内容、提示词版本、模型/运行配置隔离，没有玩家私人上下文。模型仅返回本次资料 ID；作者、标题和链接由服务端回填。未知、跨存档、跨幕以及审核撤销/内容变化的引用被拒绝。

归档释放正式账号二十个活跃存档名额；回收站保留三十天。过期且未绑定访客再保留七天。cleanup 默认仅报告数量；显式 apply 才清除到期存档、派生业务数据和每个 NPC 的检查点表记录。正在运行或待绑定的存档不清理。费用账本和最小身份墓碑保留，防止清除数据重置费用。未启用对正常完结故事的主动检查点压缩清理。

产品原始事件保留三十天、聚合一百八十天。诊断只接受白名单字段及静态资源栈位置；默认不收集原始聊天、姓名、OAuth code/state。反馈是玩家主动提交的文本。metrics 输出漏斗、失败数、平均/p95 等待和估算费用；估算单次通关成本是周期总支出/该周期完成档数，用于运营观察，不是逐个玩家精确归因。

建议在部署机上每天低峰手动确认 dry-run 后，将 `python scripts/product-admin.py cleanup --apply` 纳入已有任务调度与告警体系。调度需配置部署账户、工作目录和正确 DSN；此实现不修改本机 cron/launchd。

## 素材与性能

源 PNG 保留；WebP 背景宽度 768/1280/1672，人物 256/512/1024，文件名带内容哈希。用 `scripts/build-images.py`（需要 Pillow）重新生成 `frontend/src/assets.json` 和资源。首屏只读当前场景和角色；临近推进预取下一幕。Nginx 对哈希 WebP/JS/CSS 长期缓存；故事响应 ETag，身份和存档继续 no-store。对话区只显示最近三组，历史单页最多五十条。

发布构建检查目标：关键首屏图片合计 <=800KB，JS gzip <=150KB。桌面与手机都要检查图片解码、横向溢出和确认交互；不能仅凭 build 成功判断 UI 合格。

## 验证与公开上线门禁

```sh
# 在仓库根目录设置专用测试库。
export BTL_TEST_DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_upgrade_test_20260913
(cd backend && python -m pytest -q --cov=app --cov-report=term-missing)
(cd backend && python -m mypy app)
python -m ruff check --config backend/pyproject.toml backend scripts
python -m ruff format --config backend/pyproject.toml --check backend scripts
python scripts/check-generated.py contract
(cd frontend && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:coverage && pnpm build)
# 启动独立 mock API + Web 后：
(cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:18732 pnpm test:e2e)
python scripts/test-disconnect.py
python scripts/test-restart.py
python scripts/test-log-redaction.py
python scripts/evaluate-semantics.py
python scripts/check-product-assets.py
# 对已完成端到端测试的专用预览库执行恢复与维护演练；脚本会销毁自己创建的副本：
python scripts/test-product-operations.py --source btl_upgrade_preview_20260913
# 真实模型必须显式启用；最大估算预算 2 USD，未跑完会报告剩余并返回失败：
python scripts/evaluate-semantics.py --real --budget-usd 2 --output artifacts/semantic-v2-real.json
```

真实语义集固定九十例（三角色×五情境×六表达）。规则正确率至少95%，重大选择自动提交、越权变更、私人信息泄漏、虚构成功分别零容忍；报告不以一个综合分掩盖失败。人设和复盘另按报告中的量表抽查。mock 只验证工具链/规则，不证明真实模型语义质量。

必须另行验收：新旧知乎账号、拒绝授权、重复回调、过期、多标签页、运行中绑定及中断后的真实合作方流程；机外 TLS、代理 IP、日志、备份恢复；10–15 位目标玩家试玩，至少80%无指导完成第一幕、70%能说明一种选择后果，并记录续玩意愿。未完成这些门禁时，状态应写“工程 mock 验证通过，待公开上线验证”。
