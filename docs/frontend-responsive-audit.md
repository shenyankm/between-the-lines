# 桌面与移动网页适配审查（2026-09-14）

关联 [Issue #22](https://github.com/shenyankm/between-the-lines/issues/22)、#9、#20、#21。初审基线为 #21 的 `fedfc65`；实现起点 `7f7e139` 与其文件树一致。#20、#21 合并后，专项基于 `main` 的 `ecf2511`（同一文件树）提交。只修改前端展示、内部操作状态及其验证，不修改故事或后端行为。

## 缺陷与改进

| 编号 | 分类 / 优先级 | 复现与原行为 | 本次结果与证据 |
| --- | --- | --- | --- |
| UI-01 | 已复现缺陷 / P1 | V3 → 工作系统 → 人事申请：原生下拉框深色文字落在相近的深色背景，对比度约 1.12:1 | 原生控件复用深色表单变量；实测下拉框前景 / 背景对比度 11.41:1；[表单与错误](screenshots/responsive/hr-error.jpg) |
| UI-02 | 已复现缺陷 / P1 | 打开人事面板，填写申请后返回 422；主舞台错误被模态层遮挡 | 当前可访问面板中显示唯一一份状态、错误及现有恢复入口；保留已填写的原因、安排和现场草稿；[就近错误](screenshots/responsive/hr-error.jpg) |
| UI-03 | 已复现缺陷 / P2 | 打开长退出申请确认框；初始焦点落在底部按钮，标题滚出视口 | 初始聚焦标题，正文从顶部开始；正文滚到末尾后标题与操作区仍可见；[长确认框](screenshots/responsive/confirmation-390.jpg) |
| UI-04 | 已复现缺陷 / P2 | 旧版手机抽屉滚动到底部，关闭按钮随正文消失 | 独立标题 / 关闭区与滚动正文；补齐可访问名称，Esc 恢复焦点；[旧版抽屉](screenshots/responsive/legacy-panel-320.jpg) |
| UI-05 | 已复现缺陷 / P2 | 手机工具覆盖人物，844×390 横屏装饰占位导致首屏没有正文 | 舞台采用独立的标题、工具、人物、对白区域；低高度缩小人物区域；[手机](screenshots/responsive/stage-390.jpg)、[桌面](screenshots/responsive/stage-1440.jpg)、[横屏](screenshots/responsive/landscape.jpg) |
| UI-06 | 合成兼容夹具复现 / P2 | 存档含 `cut_ties` 等代码或 outcome.title 时直接显示 ending 原值；V3 仍显示旧版 stress | 优先保存的结局标题，再映射已知中文结局，未知代码显示“故事已结束”；按版本显示内耗 / 压力或旧版心绪。当前后端正常结局本身已写入中文；本项也覆盖历史 / 合成边界，不宣称所有真实存档都有代码泄漏 |
| UI-07 | 已复现反馈缺失 / P2 | 存档归档、回收、恢复等待时没有卡片状态 | 每卡同步锁与禁用状态，处理中提示、就近失败提示；成功刷新列表并播报结果；单卡重复点击仅发一次写请求 |
| UX-01 | 体验改进 / P2 | 空历史、无观点和禁用表单缺少解释 | 空记录、整理中、失败 / 未知、成功无观点均明确说明；禁用原因沿用服务端 available_actions，材料不足说明缺少什么 |
| UX-02 | 体验改进 / P2 | 不同版本控件和弹层几何不一致 | 沿用 HeroUI 3.2.5、CSS Modules、原生 dialog；统一颜色、焦点、44px 操作高度、安全区和动态视口；[幕间](screenshots/responsive/interlude-844.jpg) |

修复前截图存于 Issue #22 的附件；本页选图均为合成公开故事夹具，没有私人对话。确认框截图特意截取正文已滚到底部的状态，初始 scrollTop=0 由测试断言验证。其余完整截图按浏览器输出至 `artifacts/responsive/`，CI 上传到 `integration-results`（7 天保留期）。

## 源码、状态与截图矩阵

路径以下均相对 `frontend/src/`；自动化实现为 `frontend/e2e/responsive.spec.ts` 和现有 `frontend/e2e/` 主流程。

| 页面 / 区域 | 源码入口 | 检查状态 | 视口与证据 | 问题 |
| --- | --- | --- | --- | --- |
| 首页 / 路由回退 | App.tsx、features/Home.tsx | 未登录、登录、加载、登录失败、无存档 / 继续故事 | 320 / 768 / 1440；`*-home-*.jpg`；Mock recovery、flows | UX-02 |
| 存档 | features/Home.tsx、features/savePresentation.ts | 0 / 1 / 2 / 5 / 7 卡片、归档 / 回收 / 恢复、处理中 / 错误、不同版本 / 结局 | 320 / 768 / 1440；`*-saves-*.jpg`；Home.test.tsx；Mock saves-layout / flows | UI-06、07 |
| V3 舞台 | features/v3/PlayV3.tsx、Stage.tsx、V3.module.css | 剧本 / 当前对白、长标题 / 长对白、可用 / 禁用操作、草稿、回合忙碌 / 恢复 | 全宽度矩阵；`*-stage-*.jpg`、`*-long-stage-*.jpg`、`*-landscape.jpg`；PlayV3.interactions、Mock recovery / errors | UI-02、05、UX-02 |
| 我的手机 | PlayV3.tsx 的联系人 / 消息区域 | 联系人、私聊 / 群聊、历史、独立草稿 | 390×844；`*-panel-我的手机.jpg`；Mock flows / draft-recovery | UI-02、UX-02 |
| 工作系统 | Work.tsx、SupportForm.tsx | 采购、材料、请假 / 求助、退出、未授权 / 忙碌禁用、提交 422 保留输入 | 390×844；`*-hr-error.jpg`；Work.test.tsx、Mock product-v3 | UI-01、02、UX-01 |
| 关系图 | Relations.tsx、followUp.ts | 图 / 列表、长关系说明、查看依据、失败、后续选择 | 390×844；`*-panel-关系图.jpg`；Relations.test.tsx、Mock panels-layout / ending-variants | UX-02 |
| 知乎众议 | Discussion.tsx | 加载、整理中、完成、失败 / unknown、无卡片、复制后编辑 | 390×844 / 1440×900；`*-panel-知乎众议.jpg`、`*-discussion-*.jpg`；Discussion.test.tsx | UX-01 |
| 完整记录 | features/game/EventHistory.tsx | 空、30 条长记录、分页、更早记录、读取错误 | 320×844 / 844×390 / 1440×900；`*-long-history-*.jpg`；EventHistory.test.tsx | UX-01、02 |
| 确认决定 | PlayV3.tsx 的 confirmation | 长申请、初始焦点、滚动、取消、提交失败 | 390×844 / 844×390；`*-confirmation-*.jpg`；PlayV3.interactions.test.tsx | UI-03 |
| 幕间 | SceneInterlude.tsx | 长文、低高度、正文滚动、返回当前剧情、下一幕 | 320×844 / 844×390 / 1440×900；`*-interlude-*.jpg`；SceneInterlude.test.tsx | UX-02 |
| 结局 / 分享 | Ending.tsx、EndingNarrative.tsx | 长回顾 / 事实、running / completed / failed / unknown、中文标题、分享图与复制 | 390 / 1440；`*-ending-*.jpg`；Mock ending-layout / game | UI-06、UX-02 |
| 旧版 / 只读 | features/game/Play.tsx、GameStage.tsx、Conversation.tsx、GameDrawer.tsx、ProductPanel.tsx | 原对话 / 行动、抽屉长文、失败保留输入、旧存档只读 | 320 / 768 / 1440；`*-legacy-*.jpg`、`*-legacy-panel-*.jpg`、`*-read-only.jpg`；Mock legacy-ui | UI-04、UX-02 |
| 共享状态 | ErrorNotice.tsx、ErrorBoundary.tsx、useTurnController.ts、drafts.ts、pending.ts | 加载 / 错误 / 诊断、断流、接受后恢复、重复点击、保留草稿 | 组件测试及串行 Mock recovery / errors / flows；未改重试策略与存储键 | UI-02、07 |

源码矩阵覆盖所有路由及主要组件；状态验证分布于组件测试、布局夹具与 Mock 主流程，并非每个页面 × 每种状态 × 每个尺寸的笛卡尔积。

## 验证方法与结果

- 三引擎专项：Chromium、Firefox、WebKit，单 worker，**15/15 通过**。所有 API 请求由合成夹具拦截，未匹配请求直接失败，不向真实模型或数据库写入。包含 Enter、Space、Shift+Tab、Esc、恢复焦点、按钮尺寸、弹层正文滚动及错误可见性断言。
- 舞台宽度：320、390、768、1280、1440、1920、2560px，另覆盖 540 / 600 / 700 / 850 / 900 / 1000 / 1500px 的前后 1px，以及 844×390 横屏。检查文档与弹层横向溢出、工具与人物交叠，横屏原始正文起点在首屏内。极长标题场景允许正常页面滚动，不以裁切换取首屏可见。
- 实际 Chrome 菜单缩放 **200%**：在 2560px 窗口中，CSS 视口 1280×573、devicePixelRatio=2。首页、实际 Mock 序幕、存档列表文档 scrollWidth=1272；工作侧栏 clientWidth=scrollWidth=620，滚到底后关闭按钮 y=20，Esc 返回触发按钮。验证后恢复 100%。三引擎自动化另有根字号 200% 的布局压力检查；它不等于实际浏览器缩放。
- 对比度按 [W3C SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 的相对亮度计算：普通文本至少 4.5:1，大文本至少 3:1。原生输入正文 `#e7edf3/#1d3045` **11.41:1**，次要文本 `#b4c0d0/#1d3045` **7.30:1**，金色按钮 `#15243a/#ebc16c` **9.20:1**，面板正文 `#e7edf3/#142235` **13.59:1**。下拉框使用三引擎真实 computedStyle 断言。禁用态保留 HeroUI 语义，并额外显示清晰可读的禁用原因；没有把艺术背景每个像素等同于实测纯色配对。
- 独立 `btl-ci` Mock 栈，生产构建：`make ci-stack` 后，在 frontend 运行 `CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm exec playwright test`，**108/108 通过**，单 worker 串行，含主流程、存档管理、草稿 / 断流恢复、结局分享。没有调用本地 DeepSeek 服务。当前 Makefile 的 test-e2e 环境变量写法没有传递到 pnpm，故用上述显式环境命令运行同一套测试，未将其误报为 make test-e2e 成功。
- 前端 format:check、lint、typecheck、build 通过；Vitest **283/283**，行 / 语句 **93.26%**、分支 **91.74%**、函数 **88.92%**，api.ts 四项 **100%**，门槛未调整。
- `python scripts/check-product-assets.py` 通过：51 项图片，关键图片预算上界 459,634 字节，生产 JS gzip **141,351 < 150,000 字节**。

## 边界与复验

真实手机软键盘、iOS Safari 真机、系统屏幕阅读器及操作系统原生下拉弹出菜单的逐平台外观未验证。WebKit 模拟视口不能代替这些实机结果；此次不宣称完整 WCAG 合规，也不代表真实 DeepSeek / OAuth 已就绪。无 API、数据库、迁移、存档格式、故事事实、草稿键、回合重试策略变化。交付到可审阅 PR，不合并或部署。

复验专项：在 frontend 运行 `corepack pnpm exec playwright test --config=playwright.responsive.config.ts`；默认启动 5174 的 Vite，或指定 `PLAYWRIGHT_BASE_URL` 使用现有构建。CI 安装三引擎并在生产 Mock 栈后执行本专项。完整截图与 JSON 报告是测试输出，选图留在本目录供长期审阅。
