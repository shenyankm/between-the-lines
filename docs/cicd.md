# GitHub Actions 与国内服务器发布

CI 与 Audit 在 GitHub 托管机器执行。Audit 将通过扫描的 linux/amd64 API、Web 镜像打包为同一提交的短期 artifact；生产服务器只下载、校验、导入并部署这两份镜像，不依赖 Docker Hub 下载业务镜像。基础镜像和依赖仍由 GitHub 构建机器获取。

`Deploy` 等待同一 main 提交的 CI 和 Audit 全部成功。`BTL_AUTO_DEPLOY=true` 时自动发布；设为 false 可暂停自动发布。手动进入 Actions → Deploy → Run workflow，选择 main 和 deploy、rollback 或 verify-backup。失败或被新提交替代的版本不能通过发布检查，PR 不进入生产 Runner。

生产 Runner 使用独立 btl-runner 用户、btl-production 标签及 systemd 服务，不加入 docker 组。唯一 sudo 入口为 root 所有的 `/usr/local/libexec/btl-deploy`，源码为 `scripts/deploy-release.py`。入口固定使用 `/srv/between-the-lines/current` 的 Compose 和 `.env`，不会执行 artifact 内的脚本。生产配置不复制到 Runner 工作目录。仓库当前为私有；可修改受信任发布 workflow 的成员仍相当于拥有生产发布权限，标签本身不是安全隔离。不要将该 Runner 用于公共仓库或不可信 PR。

发布事务通过服务器文件锁与 Actions concurrency 串行：校验 SHA、审核运行 ID、归档哈希、平台和镜像版本标签；导入镜像后使用服务器解析出的不可变镜像 ID。停止 API 等待在途请求结束，导出完整 PostgreSQL 备份，使用 Compose 加载原有配置执行迁移，启动容器并检查公网首页与 `/api/ready`。API 替换时有短暂维护窗口，不能宣称零停机。

发布状态位于 `/var/lib/btl-releases/state.json`，备份位于 `/var/backups/between-the-lines`，均仅 root 可读。首次安装执行 bootstrap 记录原生产镜像。健康检查失败且 schema 未改变时恢复原镜像；schema 改变后拒绝自动回退，保留备份并等待兼容修复。rollback 仅切换 schema 兼容的上一版本，不执行数据库降级，不覆盖玩家的新数据。verify-backup 在独立临时数据库实际恢复最近备份、读取存档和检查点数量后删除该临时库。

安装或更新部署入口由运维通过 SSH 将审阅过的脚本安装到 root 目录，不由 workflow 自行覆盖。Runner 注册使用 GitHub 一次性注册 token；无需在服务器保存个人 GitHub token。官方 Runner 包须核对发布校验和，随后以 btl-runner 身份配置并通过 `svc.sh` 安装服务。服务需要出站访问 GitHub、Actions 与 artifact 域名的 HTTPS 443；国内网络不稳定时只为 Runner 配置受控代理。

不自动清理镜像或备份，以免破坏回退。当前备份仍在同一服务器，应另外配置加密异地备份及保留期限。停止自动发布不会停止网站或撤销正在执行的发布。artifact 默认保留三天，超期后需要新提交重新触发 CI/Audit 构建，不能用未经扫描的手工镜像替代。
