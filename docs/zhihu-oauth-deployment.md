# 知乎 OAuth 联调与单机部署

公网入口：`https://www.openwook.cloud`。回调地址须在知乎登记为
`https://www.openwook.cloud/api/auth/zhihu/callback`。

## 协议与身份边界

`ZHIHU_PROTOCOL=standard` 保留原标准 OAuth 接法；`hackathon` 使用资源包中的
`app_id/app_key` 协议：

- 授权地址 `https://openapi.zhihu.com/authorize`。
- Token 地址 `https://openapi.zhihu.com/access_token`。
- `ZHIHU_CLIENT_ID` 对应 App ID，`ZHIHU_CLIENT_SECRET` 对应 App Key。
- `ZHIHU_ACCESS_SECRET` 是独立的开放平台凭证；developer 内容接口同时发送它和 `X-OAuth-Token`；原生 `openapi.zhihu.com/user`
  使用当前用户的 OAuth Token 作为 `Authorization: Bearer`，不把 Access Secret 当用户 Token。
- 接收 `authorization_code` 或兼容的 `code`，重复、冲突参数拒绝处理。
- 必须回传与浏览器发起记录一致且未超过十分钟的 `state`。缺失、过期、重复消费均失败，绝不根据回调时当前身份猜测来源访客。
- 2026-09-13 实测原生 `/user` 返回顶层 `uid`（数字）和 `fullname`（字符串）。
  配置 `ZHIHU_SUBJECT_FIELD=uid`、`ZHIHU_NAME_FIELD=fullname`；不使用昵称或内容作者充当身份，
  不保存其他个人资料字段。字段缺失则不签发登录会话。
- Token 与用户信息请求不跟随重定向、不输出响应正文或凭证。

资源来源：用户提供的 `https://zhstatic.zhihu.com/skill/zhihu-hackathon-skill_v2026s2.zip`，
包含 `zhihu/references/oauth.md`、`user-api.md`。未执行 Demo 初始化器，未替换当前应用架构。

## 部署

宿主 Caddy 保留 TLS，代理 `127.0.0.1:18080`。使用：

```sh
cd /srv/between-the-lines/current
docker compose -f compose.yaml -f compose.server.yaml build api web
docker compose -f compose.yaml -f compose.server.yaml up -d --wait --wait-timeout 150
```

`.env` 权限 600，独立的数据库密码及会话密钥；源代码、镜像和提交不包含配置密钥。
数据库不映射宿主端口；API 单 worker；Nginx 只发布回环地址。
镜像仓库不可达时可在构建机使用 `docker buildx build --platform linux/amd64 --load`，
设置 `BTL_API_IMAGE` / `BTL_WEB_IMAGE` 为对应版本，通过 `docker save` / SSH / `docker load`
导入目标机，然后执行 `up -d --no-build --pull never --wait`，不改变镜像来源。

Nginx 通过 Docker DNS 动态解析 API 地址，容器重建后不会持续引用旧 IP。
Caddy 配置模板见 `deploy/Caddyfile.server`，合并后先执行 `caddy validate`。
访问日志与运行日志均移除查询参数和请求头，规则参考
[官方日志过滤说明](https://caddyserver.com/docs/caddyfile/directives/log)。

Docker 专用网段 `172.31.219.0/24` 不可与宿主网络重叠。
Nginx 只信任宿主网关传来的 Caddy 转发 IP，应用只信任该私网。

第一次空库启动自动执行迁移。后续发布先按产品发布手册备份数据库和检查点，
停止写入进程，再用兼容镜像迁移；不得在有业务数据时照搬空库初始化操作。

初次联调月度 AI 额度为 2 USD，自动意图与观点卡生成关闭。
完整 OAuth、真实模型评估和公开上线门禁通过前，不宣称生产登录验收完成。

## 旧站处置与验证

PractiQ Java 后端和其 AI 服务已停止并禁用，原代码和专属配置从活动目录移除。
备份位于服务器 `/var/backups/btl-replacement-20260913/practiq.tar.gz`，目录仅 root 可读，
校验文件为同目录 `SHA256SUMS`。数据库及另一独立应用未删除。

检查 `/api/ready`、访客创建、授权重定向、错误回调及两层日志脱敏，
再由用户本人完成知乎最终授权。记录是否回传 state、Token 是否可交换、
稳定用户 ID 是否存在，以及访客存档迁移；不记录 code、Cookie、Token 或原始用户资料。

## 本次真实联调结果（2026-09-13）

- App ID 499 的公网回调成功回传 state，通过关联校验；授权码交换成功。
- 已纠正资源包示例的 `/user` 鉴权混用：它使用 OAuth Bearer，双凭证用于 developer 内容接口。
- 原生用户资料字段实测为 `uid` / `fullname`。仅将这两项用于账号，其他资料不落库。
- 最终真实回调 303；原试玩存档归属变为 member，访客 merged_into 已设置，绑定状态 completed。
- 代理已使用 Docker DNS 动态解析。更新 API 后验证 readiness 200，不需要重建 Nginx。
- Caddy、Nginx、Uvicorn 日志中不出现探针授权码或 state 查询值。
- 这验证了一次真实账号授权和访客迁移；不替代多账号、拒绝授权、并发回调的完整上线矩阵。
- 当前是手工构建上传部署；未创建自动发布工作流、未提交或推送本地改动。
