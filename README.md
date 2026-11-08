# zhangben

雪球账本

## 首次初始化

首次启动或执行 `npm run init-db` 时，仅在用户表为空的情况下创建 `admin` 管理员，并要求首次登录后修改密码。项目不再使用固定的初始密码。

可通过 `INITIAL_ADMIN_PASSWORD` 环境变量设置首次登录密码，要求至少 15 个 Unicode 字符，且不超过 72 个 UTF-8 字节。以 PowerShell 为例：

```powershell
$env:INITIAL_ADMIN_PASSWORD = 'replace-with-your-own-strong-password'
npm run init-db
```

未设置该变量或值为空时，程序会生成随机临时密码，仅在首次创建管理员时输出到终端。请保存该密码并尽快登录修改；后续启动不会再次显示或重置密码。通过 `npm start` 启动时，也可在项目的 `.env` 中配置该变量。

已有用户时，初始化不会重新创建管理员，也不会覆盖密码；修改管理员用户名后重启同样保留原账号。升级不会自动删除历史账号，已有安装如曾触发过默认账号重建问题，应由维护者核查现有账号。

## 公网部署：宿主 Nginx + Docker Compose

此部署方式由宿主 Nginx 使用已有域名和证书提供 HTTPS，Compose 将应用端口只发布到宿主 `127.0.0.1`。前端生产构建由 Node 服务提供，公网仅开放 Nginx 的 80/443 端口；不要将 Vite 开发服务器或 Node 后端端口直接暴露到公网。

### 1. 准备配置和数据

首次部署从 `.env.example` 复制 `.env`。已有安装保留现有配置和数据，先停止旧服务并备份完整数据目录，再更新配置和镜像；复制运行中的 SQLite 文件可能遗漏 WAL 中的数据。

生产环境需要以下配置：

| 变量 | 要求 |
| --- | --- |
| `SESSION_SECRET` | 独立生成的随机密钥，至少 32 个 UTF-8 字节；不能使用示例值。可使用 `openssl rand -base64 48` 生成并填入 `.env`。 |
| `SESSION_COOKIE_SECURE` | 必须为 `true`，会话只通过 HTTPS 使用。Compose 已固定此值。 |
| `PUBLIC_ORIGIN` | 对外访问的 HTTPS Origin，例如 `https://ledger.example.com`，不带路径、查询参数或结尾 `/`。域名应与反向代理一致。 |
| `TRUSTED_PROXIES` | Node 实际看到的可信代理来源 IP 或 CIDR，多项用逗号分隔；按下文核实，不使用全网信任配置。 |
| `PORT` | 宿主回环端口，默认 `3000`。容器内固定使用 `3000`；修改此项时同步修改 Nginx 的 `proxy_pass`。 |
| `INITIAL_ADMIN_PASSWORD` | 可选，仅空用户表首次创建管理员时生效，至少 15 个 Unicode 字符且不超过 72 个 UTF-8 字节；留空生成随机密码。 |

在 Linux 宿主为数据目录设置容器用户权限。新镜像的运行 UID/GID 固定为 `10001:10001`，代码和依赖保持 root 所有，只有数据目录需要可写：

```sh
mkdir -p ./data
sudo chown -R 10001:10001 ./data
sudo chmod 700 ./data
chmod 600 .env
```

已有数据目录也需检查所有权；执行递归修改前，确认当前工作目录是本项目目录且已备份。不要用 `chmod 777` 解决权限错误。备份中包含账本和会话数据，应使用相同访问限制。

### 2. 构建修复后的镜像并核实可信代理

Compose 默认从当前仓库构建 `zhangben:local`，避免继续运行旧远程镜像。Docker 构建会自动执行前端和后端安全回归，全部通过后才生成生产镜像；依赖安装保持独立缓存层。先构建和创建容器，不启动服务：

```sh
docker compose config --quiet
docker compose build --pull
docker compose create
docker inspect zhangben --format '{{json .NetworkSettings.Networks}}'
```

根据最后一条命令显示的网络名执行 `docker network inspect NETWORK_NAME`，查看桥接网络配置。宿主 Nginx 通过发布端口访问 Docker 容器时，后端通常看到 Docker 桥接网关地址；它不一定看到 `127.0.0.1`。将实际来源地址写入 `.env` 的 `TRUSTED_PROXIES`，优先使用单个 IP。Docker Desktop、rootless Docker 或不同代理拓扑可能表现不同，需通过连接日志或网络抓包核实。

不要仅因为 Nginx 与 Docker 位于同一台机器就填写 `loopback`，也不要直接复制其他服务器的默认桥地址。`loopback` 仅适用于后端确实通过回环接口接收代理连接的部署。生产环境在未配置可信代理、HTTPS Origin 或合规会话密钥时会拒绝启动。

保持宿主端口只发布到 `127.0.0.1`，不要把不可信容器加入应用网络，并通过主机防火墙和云安全组限制入口。回环端口不应通过其他代理、隧道或端口转发重新对公网公开。端口发布规则以 [Docker 官方说明](https://docs.docker.com/engine/network/port-publishing/) 为准；应使用仍受支持、已安装安全更新的 Docker Engine。

### 3. 配置已有 HTTPS 反向代理

参考 [deploy/nginx.conf.example](deploy/nginx.conf.example)。该文件需要放在 Nginx 的 `http` 配置上下文中，并将所有 `ledger.example.com`、证书路径以及后端端口改成实际配置。已有站点应合并到当前配置，避免重复的域名监听。

示例将 HTTP 重定向到固定 HTTPS 域名，启用 TLS 1.2/1.3、HSTS、100 KiB 请求体上限和连接超时，并覆盖 `X-Forwarded-For`、`X-Forwarded-Proto` 等头。不要透传访客提供的转发头。请求头覆盖方式可参阅 [Nginx 官方代理模块文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)。若 Nginx 前还有 CDN 或负载均衡，先限制和配置其可信来源，再按实际链路调整；此示例面向 Nginx 直接接收公网 HTTPS 的情况。

仓库中的 Nginx 文件是待审阅示例，尚未在实际服务器验证。配置完成后，由服务器维护者执行 `nginx -t`，确认语法和证书文件正常后再重载 Nginx，然后启动当前构建：

```sh
docker compose up -d --build --pull never
```

仅首次创建随机初始密码时，需要从服务日志取得密码并立即完成首次改密。配置了 `INITIAL_ADMIN_PASSWORD` 时不打印该密码。容器保持非 root 运行并移除 Linux capabilities、禁止提权；数据目录保持可写以支持 SQLite。

### 4. 上线验证和账号核查

确认 HTTP 请求跳转到配置的 HTTPS 域名，HTTPS 可以正常登录，会话 Cookie 带有 `Secure`、`HttpOnly` 和 `SameSite=Lax`。从其他机器访问 `http://服务器公网IP:PORT` 应失败。HTTPS 登录失败或请求被拒绝时，先核对 `PUBLIC_ORIGIN`、Nginx 覆盖的头以及应用实际看到的代理来源，避免通过关闭 HTTPS 检查解决。

本次升级会要求现有登录会话重新登录。修改密码会撤销其他客户端会话，当前客户端会轮换会话和 CSRF 令牌。旧短密码用户登录后需先设置至少 15 个 Unicode 字符、且不超过 72 个 UTF-8 字节的新密码，才能继续访问账本。会话最长 8 小时，连续 30 分钟无活动需重新登录；活动时间最多每分钟持久化一次。

API 写请求要求未压缩 JSON 和有效 CSRF 令牌，API 响应禁止缓存。默认限制如下，触发时返回 HTTP 429，应等待对应窗口结束后重试：

| 范围 | 限制 |
| --- | --- |
| 全部 API 请求 | 每个来源 IP 每分钟 120 次，在建立会话之前限制。 |
| 未登录 CSRF 令牌获取 | 每个来源 IP 每 5 分钟 20 次。 |
| 登录尝试 | 每个来源 IP 和每个用户名分别限制为每 5 分钟 5 次。 |
| 修改密码 | 每个用户每 5 分钟 5 次。 |

匿名会话记录 10 分钟过期，过期记录每分钟清理；会话存储上限为 10,000 条，防止匿名请求无限增加磁盘记录。应确保真实来源 IP 被可信代理正确覆盖，否则不同访客可能共用代理 IP 的限流额度。

初始化修复不会自动删除历史账号。旧版曾在管理员改名后重建 `admin`，已有安装应在开放公网入口前核查用户表，确认没有遗留的已知密码账号。可由维护者在备份后使用只读数据库工具检查用户 ID、用户名和创建时间；若发现未知账号，先保持公网入口关闭，再核实并处理账号及会话。

## 验证

运行 `npm test --prefix server` 和 `npm test --prefix client` 执行前后端安全回归，运行 `npm run build` 检查前端生产构建。Docker 构建同样要求两侧回归通过。测试使用内存或临时数据库，不使用现有账本。
