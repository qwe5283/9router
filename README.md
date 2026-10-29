# 9Router

基于 [decolua/9router](https://github.com/decolua/9router) 的 rebase 分支，在保留上游功能的基础上，增强 OpenAI / Anthropic 兼容 Provider 的请求与响应控制。

- **上游仓库**：https://github.com/decolua/9router
- **当前仓库**：https://github.com/qwe5283/9router

## 快速开始

准备 Docker、Docker Compose、Git、`sed` 和 OpenSSL，然后在 Linux 或 WSL 终端中克隆并启动：

```bash
git clone https://github.com/qwe5283/9router.git
cd 9router
cp .env.example .env

# 生成随机初始密码和密钥，并写入 .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^INITIAL_PASSWORD=.*|INITIAL_PASSWORD=$(openssl rand -hex 16)|" .env
sed -i "s|^API_KEY_SECRET=.*|API_KEY_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^MACHINE_ID_SALT=.*|MACHINE_ID_SALT=$(openssl rand -hex 32)|" .env

docker compose up -d --build
```

**中国大陆地区网络受限时：**

如果 GitHub 克隆失败，将克隆命令替换为以下命令，然后进入目录并执行相同的 `.env` 配置步骤：

```bash
git clone https://gh-proxy.org/https://github.com/qwe5283/9router.git
cd 9router
```

生成 `.env` 后，将 `docker compose up -d --build` 替换为以下命令，使用阿里云 APK 镜像和 npmmirror 构建，无需修改 Compose 文件：

```bash
docker build \
  --build-arg ALPINE_MIRROR=mirrors.aliyun.com \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  -t 9router:local .
docker compose up -d --no-build
```

以上换源仅影响 APK 和 npm；如果 Docker Hub 或 GHCR 镜像拉取失败，还需在 Docker 中配置可信的镜像加速器或网络代理。更新代码后，中国大陆地区同样使用以上 `docker build` 和 `docker compose up -d --no-build` 命令重新构建并启动。

请妥善保管 `.env`，不要提交或泄露其中的密码和密钥。Compose 会从当前源码构建镜像，并同时启动 Headroom；数据保存在 `9router-data` Docker volume 中。

- **`JWT_SECRET`**：用于签名和验证 Dashboard 登录会话的 JWT 密钥，防止他人伪造登录状态。
- **`INITIAL_PASSWORD`**：尚未单独设置 Dashboard 密码时使用的初始登录密码，启动后可通过该值登录 Dashboard。
- **`API_KEY_SECRET`**：用于生成和校验 9Router API Key 的 HMAC 密钥，不是上游 AI 服务商的 API Key。
- **`MACHINE_ID_SALT`**：对机器 ID 进行哈希时使用的盐值，用于生成实例标识并避免直接暴露原始机器 ID。
- **`TRUSTED_PROXY_IPS`**（可选）：允许提供 `X-Real-IP` / `X-Forwarded-For` 的反向代理 IP，多个地址用逗号分隔。Nginx 经 Docker 网桥转发时，可用于让 Dashboard 登录记录和限流识别真实客户端 IP，而不是记录网桥地址。回环代理始终受信任。

例如，Nginx 到容器的来源地址为 `172.20.0.1` 时，在 `.env` 中设置：

```dotenv
TRUSTED_PROXY_IPS=127.0.0.1,172.20.0.1
```

仅填写实际受信任的代理地址，不要配置整个 Docker 私网，否则同网段客户端可能伪造 IP、绕过限流。

启动后可访问：
- Dashboard：http://localhost:20128/dashboard
- OpenAI 兼容 API：http://localhost:20128/v1
- Headroom：http://localhost:8787

常用命令：

```bash
# 查看启动状态
docker compose ps

# 查看日志
docker compose logs -f

# 更新源码后重新构建并启动
docker compose up -d --build

# 停止服务（保留数据）
docker compose down
```

## 相比上游的 rebase 功能清单

本分支首次 fork 于 `3a978a6`，以下清单记录当前相比上游仍保留的功能差异。每次新增或修改功能后，推送前检查最新 `origin` 与 `upstream` 的差异，并同步更新本清单；具体流程见 [AGENTS.md](./AGENTS.md)。

### 1. 自定义 Provider 请求头

- 支持为 Provider 配置自定义 HTTP 请求头，覆盖内置的同名默认请求头，不受请求头名称大小写影响。
- 扩展兼容执行器对自定义请求头的支持，覆盖 Cursor、GitHub Copilot 和 Zed。
- 提供内置请求头恢复功能，并兼容已有的自定义请求头配置。
- 支持“使用客户端 User-Agent”开关（默认关闭）：开启后优先将原始客户端的 `User-Agent` 转发给上游，客户端未提供时沿用自定义表单或 Provider 的默认配置。

### 2. 兼容 Provider 请求体透传

- 为 OpenAI Compatible 和 Anthropic Compatible Provider 增加“透传”开关。
- 开启后保留客户端原始请求体，仅替换为实际上游模型名。
- 跳过格式转换、请求规范化、工具去重、Provider Thinking 注入及 Token Saver 等请求改写。
- 原样转发上游 HTTP 或 SSE 响应，同时保留用量统计与请求日志。
- 使用时应确保客户端请求格式与上游接口一致；该模式默认关闭。

### 3. 可配置的重试与回退策略

- 为兼容 Provider 增加“回退”开关，默认开启，保持上游默认行为。
- 关闭后仅请求当前账号和上游地址，不再执行同地址重试、备用地址切换、Token 刷新重试或多账号切换。
- 上游错误按原始 HTTP 状态、响应头和响应体返回，包括 SSE 错误。
- 请求来自 Combo 时也不会自动切换到其他模型。
- 原样返回上游响应的同时，继续记录请求状态和用量信息。

### 4. 自定义 Provider 头像

- OpenAI Compatible、Anthropic Compatible 和 Custom Embedding 节点支持在新增或编辑时选择头像。
- 可从项目内置的 Provider 图标中搜索并选择，也可恢复默认头像。
- 所选头像同步显示在 Provider 列表和详情页，并随节点配置持久化保存。

### 5. Dashboard 登录历史记录

- 记录密码、OIDC 和 SAML 登录尝试，在个人资料页面展示最近 20 条记录，最多保留 1,000 条。
- 记录登录时间、结果、失败原因、登录方式、客户端 IP 和 User-Agent，不保存密码、Token 或身份提供商原始断言。
- 支持通过 `TRUSTED_PROXY_IPS` 配置可信反向代理 IP，使 Nginx / Docker 部署在登录记录和限流中使用真实客户端 IP，而非 Docker 网桥地址。

### 6. 请求日志与可观测性配置修复

- `ENABLE_REQUEST_LOGS` 仅控制请求调试日志，不再覆盖 Dashboard 的可观测性开关。
- 请求详情记录优先遵循 Dashboard 的 `enableObservability` 设置，未设置时使用 `OBSERVABILITY_ENABLED` 作为默认值。

### 7. 本地源码构建与 ACR 镜像发布

- Docker Compose 默认从当前源码构建 `9router:local` 镜像，使部署包含本分支的功能变更。
- 本机部署定制放入不纳入版本控制的 `docker-compose.override.yml`，避免将主机配置带入仓库。
- 支持手动触发 GitHub Actions 构建 `linux/amd64` 镜像，通过容器健康检查后发布到阿里云 ACR，同时更新指定标签和 `latest`，并校验两者指向同一镜像。
- Docker 构建支持通过 `BUILD_NODE_OPTIONS` 单独设置编译阶段的 Node.js 参数。

## 常见问题（Q&A）

### 1. 开启透传、关闭回退会如何影响 Combo？

“透传”和“回退”是两个独立开关：

- **只开启透传，保持回退开启**：当前 Provider 失败后，Combo 仍可切换到后续模型。若后续节点也开启透传，它们收到的同样是原始请求体，因此客户端请求格式必须与相应上游接口兼容。
- **开启透传并关闭回退**：不再进行同地址重试、备用地址切换、失败后的 Token 刷新重试或多账号切换；当前节点返回响应后，Combo 也不会继续尝试后续模型。
- 关闭回退只禁止失败后的兜底，不会取消 Combo 对本次请求起始模型的轮询、粘性或 Smart 选择。

需要原始厂商字段和错误响应时，可以关闭回退；需要 Combo 容灾时，应保持回退开启。

### 2. 单模型 Combo 可以当作自定义模型 ID 的一对一映射吗？

在普通 Combo 策略下，可以。例如将客户端的 `my-model` 映射到某个 Provider 节点及其上游模型 `vendor-actual-model`。客户端使用 `my-model`，发送给上游时仅将 `model` 替换为 `vendor-actual-model`，适合统一模型 ID 或在不修改客户端的情况下更换后端。

它仍会经过 Combo 的路由和日志链路，并非纯粹的改名：

- Combo 只有一个模型时，没有其他 Combo 模型可切换。
- 保持回退开启时，仍可能发生同地址重试、备用地址切换或多账号切换。
- 如需失败时直接返回当前节点的结果，可再关闭该 Provider 的回退。

### 3. 单模型 Combo + 透传 + 关闭回退时，Combo 会改写原始请求体吗？

使用 `fallback`、`round-robin`、粘性或 `smart` 等普通策略时，不会。Combo 使用请求的工作副本选择模型，透传则读取入口保存的原始请求体副本；发送给上游时只替换 `model`，其余厂商扩展字段、工具定义和 Thinking 配置保持原样，也不会执行格式转换或 Token Saver 等请求改写。

`fusion` 会对候选请求和响应进行额外处理，不应当作严格透传或一对一映射使用。无论采用哪种组合，透传都要求客户端请求格式与实际上游接口一致。

### 4. Combo 列表混合选择开启和关闭回退的模型时，关闭回退的节点会短路 Combo 吗？

会，但准确地说，该节点的响应会被视为**终止响应**，而不是被改判为“正常响应”：

```text
Combo：A（允许回退） → B（禁止回退） → C（允许回退）
```

- A 返回可回退的错误：继续尝试 B。
- B 返回成功或 HTTP/SSE 错误：都直接返回 B，不再尝试 C。
- B 的错误状态、响应头和响应体仍会保留，并跳过 Combo 的空响应探测与后续回退。

此短路针对节点已经返回的 HTTP `Response`。如果节点因网络或执行故障抛出未包装成 `Response` 的异常，Combo 的异常捕获仍可能继续尝试后续模型；因此“关闭回退”不保证所有异常场景下都绝对只请求一个 Combo 成员。

**安全提示**：原样透传上游错误可能将厂商诊断信息暴露给客户端；对外提供服务前，应确认客户端有权查看这些信息。
