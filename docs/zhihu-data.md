# 知乎公开参考数据

已使用用户授权的 Access Secret，通过官方知乎搜索接口导入首批数据：5 个主题，每个 5 条，共 25 条独立内容。主题为同事贬低与边界、聚餐排挤、采购流程沟通、跳槽谣言、自我成长。

数据在 Docker 容器 `between-the-lines-db-1` 的 `btl` 数据库、`public.zhihu_contents` 表。包括标题、服务提供的摘要、公开作者昵称、原文链接（保留溯源参数）、赞同/评论数量、检索主题、采集时间。按内容类型和内容 ID 联合去重，重复导入更新内容与统计，合并主题。

这是独立参考资料表，不代表玩家账号，不包含授权用户的私密内容，也没有自动注入 NPC 记忆或接入锦囊展示。搜索相关性和观点质量仍需在对玩家展示前筛选。

凭证保存于本机 `backend/.env` 的 `ZHIHU_ACCESS_SECRET`，文件权限 0600、Git 忽略，不使用 OAuth 密钥或 DeepSeek 密钥。导入程序仅向 `developer.zhihu.com` 的公开数据接口发送该凭证，不跟随重定向；来源链接只接受 HTTPS 知乎域名。

使用已有 Miniconda，在 backend 目录执行：

```sh
python -m alembic upgrade head
python -m app.zhihu_import
# 自定义主题，每次最多十个主题、每个最多十条
python -m app.zhihu_import --query '职场沟通边界' --count 5
```

程序先查询剩余额度，每个主题请求一次搜索；每批数据单独提交。后续请求失败时保留已经导入的批次，不把失败结果记为成功。完成报告保存在 `artifacts/zhihu-import.json`，其中不包含密钥。

[搜索接口文档](https://developer.zhihu.com/docs?key=zhihu_search) · [鉴权文档](https://developer.zhihu.com/docs?key=authorization)

## 第二轮扩充

新增 30 个检索主题，每主题 10 条返回，共处理 300 条；按内容类型和 ID 去重后净增 294 条，数据库现有 319 条。主题清单见 `docs/data/zhihu-topics.json`，覆盖三幕职场事件以及伴侣关系、母女沟通、独立选择和自我成长。

实查知乎搜索额度：累计已用 35 / 5000，剩余 4965。发生一次短时频率限制后，保留已提交批次并从未完成主题恢复；导入器现对同批主题间隔 4 秒，避免连续突发请求。间隔不是平台速率保证，仍应处理限流。

全部 30 个主题都核对到 10 条关联记录。现有 20 条内容没有返回作者昵称，保留为空，不补造作者。部分检索结果偏产品介绍，数据作为候选参考资料，尚未逐条精选或自动接入 NPC。汇总报告：`artifacts/zhihu-expansion-summary.json`。
