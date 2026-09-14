# 结局海报与 AI 内容质量交付记录

日期：2026-09-14。分支：`sheny/ending-art-content`。基线：`781501b`。

## 交付内容

- 六张原始海报保存在 [素材目录](assets/ending-posters/README.md)，逐张使用 imagegen 清理标题、正文、手写文字，保留画面与纸张装饰。运行时引用清理后的 WebP；新增图片独立于头像分类校验。
- E01 改写规则、E02 各自为界、E03 有限修复、E04 主动转身、E05 付出代价、E06 尚未破局，通过已有 outcome.id 映射，不改变结局优先级。
- 按用户追加的“字体、内容布局也和图片保持一致”，桌面与手机统一纵向海报；中文衬线标题、居中层级、右上编号、灰绿色副标题、通栏插画、下方宋体正文。原图没有字体元数据，Noto Serif SC 是相近字形替代，不宣称精确识别了原字体。400/600 字重本地托管并附 OFL，101 个 unicode-range 子集总计 6,027,992 字节，按实际字符加载。
- 六种结局均明确本局结束；未破局只表示问题未解决。AI 正文保留原请求标识、任务与回退，成果、未解事项、四指标仍读取已保存状态。
- 分享预览、复制、PNG 使用同一内容；默认结局、表达风格、四指标，最多勾选三条事实。900px 宽、至少 1600px 高，按测量增高，等待字体和图片；不默认带聊天或 AI 长文。图片加载失败可生成文字海报，导出失败保留复制入口。
- 众议对最多十条检索结果按编号、URL、正文去重，优先不同问题/来源，最多六候选。第二幕聚焦具体退回依据、流程记录与协调。模型策略为直接沟通、流程协作、暂缓观察；校验重复类别/表达、来源越界和原文引用，不足则少展示或编辑回退。
- 复盘基于事件动作、角色、渠道和同轮反馈。明确玩家是周菱菱，区分提交审核与同事审批；查看复核/澄清/补救结果只作为背景。无明确玩家行动时零模型调用，仅事实回顾。针对实际复现的谣言对象/转述者互换、以同事口吻称呼玩家、活动参与意愿归属互换补充检查。
- 提示版本从 4 更新到 6；新众议不复用旧提示结果，既有 request_id 优先返回原任务。内部角色和引用校验字段不会新增到公共卡片/复盘字段中。仍为 deepseek-flash、首次生成加一次修复，不增加模型评审。

## 工程与浏览器证据

| 检查 | 结果 |
|---|---|
| 后端全套（独立 PostgreSQL） | 365 passed；覆盖率 83.66%，门槛 82% |
| 前端全套 | 286 passed；lines/statements 92.88%，functions 88.73%，branches 91.67%；api.ts 100% |
| lint / 格式 / mypy / TypeScript | 通过；mypy 38 个模块 |
| API 契约 | no drift，工作区生成文件未变化 |
| 生产构建 | 通过；JS gzip 143,676 bytes < 150,000 |
| 图片预算 | 当前普通场景保守上界 459,634 bytes；单张结局最大 87,162 bytes < 800,000 |
| Chrome 桌面与手机模拟 | 30 passed，0 failed / skipped / flaky |

浏览器覆盖六结局、六组实际 PNG 下载、320px、长正文与事实、生成中/失败、图片失败、键盘勾选、无横向溢出，以及参加/未参加欢送会、同意/拒绝后续邀请、原材料合格/补充、职责损失纠正/未纠正和主动结束未解决问题的已有路线审计。

[桌面截图](screenshots/ending-posters/desktop-E03.jpg) · [手机截图](screenshots/ending-posters/mobile-E03.jpg)。完整六套截图与实际 PNG 保存在本地 `artifacts/ending-posters/{desktop,mobile}/`；浏览器 JSON 为 `artifacts/ending-posters-browser-final.json`。这些是合成验收存档；不包含私人真实对话。

## 真实模型验收

独立数据库 `btl_poster_ai_20260914`，服务费用上限 2 USD。未使用生产库，未修改旧存档。

| 样本 | 实际结果 |
|---|---|
| 第一幕众议 | 2 类：直接沟通、暂缓观察 |
| 第二幕众议 | 3 类：具体退回原因、流程与记录、暂缓重提 |
| 第三幕众议 | 3 类：正式说明事实、组织渠道留证、暂不回应 |
| 六种结局复盘 | 均为 completed；14 个建议节点，逐条审阅执行者为玩家 |
| 六种结局正文 | 均真实生成完成，非回退 |

来源引用均在冻结的检索结果集合中，并通过连续原文摘要校验；对相关性和观点差异进行了人工复核。不把编辑回退计为成功，不把这些样本描述为知乎整体主流。来源有效在本次验收中指 API 返回来源及其 URL/摘要引用一致，不等同于保证所有知乎页面对匿名浏览器永久可访问。

调试期间真实模型曾产生错误来源引用、角色互换和一次生成失败，这些任务留在测试库，未重写成成功。累计模型费用估算 0.1068315 USD，失败调用另保留预算 0.0472203 USD，合计承诺约 0.1540518 USD，低于 2 USD。最终众议证据为 `artifacts/ending-posters/real-ai-final.json`，最终复盘证据为 `artifacts/ending-posters/real-reflections-accepted.json`；较早未通过人工审阅的输出不属于验收通过样本。

质量校验针对结构、来源和已复现的角色错误，不能证明开放式模型永远不出语义错误；失败时仍走既有回退。手机验收为 Chrome 模拟视口，未声称完成 iOS Safari 真机验收。

## 复现与兼容

```sh
# 独立测试库应先迁移；不要与其他数据库测试并发运行
cd backend
BTL_TEST_DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_upgrade_test_poster_20260914 python -m pytest --cov=app
cd ../frontend
corepack pnpm test:coverage
cd ..
make lint typecheck contract build
python scripts/check-product-assets.py
make ci-stack
cd frontend
PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm exec playwright test e2e/ending-posters.spec.ts e2e/ending-audit.spec.ts e2e/ending-edge-audit.spec.ts e2e/ending-layout.spec.ts
```

真实验收仅在配置 2 USD 服务上限和独立库后，显式运行 `python scripts/audit-real-endings.py --real --poster-quality --url http://127.0.0.1:18012 --output artifacts/ending-posters/real-ai.json`。`--poster-quality` 给每条路线加入明确的合成玩家表达，供六结局检验角色归属；无玩家动作分支另由数据库集成验证事实回顾。

无数据库迁移、路由变动、存档批量重写、生产部署或知乎发布。原始海报和历史文档记录保留；预提交大文件例外仅增加这六个指定原始 PNG。
