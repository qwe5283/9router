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

以下功能基于 `3a978a6` 首次 fork 以来的差异整理。

### 1. 自定义 Provider 请求头

- 支持为 Provider 配置自定义 HTTP 请求头，覆盖内置的同名默认请求头，不受请求头名称大小写影响。
- 扩展兼容执行器对自定义请求头的支持，覆盖 Cursor、GitHub Copilot 和 Zed。
- 提供内置请求头恢复功能，并兼容已有的自定义请求头配置。

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

### 4. 复用客户端 User-Agent

- Provider 自定义配置中新增“使用客户端 User-Agent”开关。
- 开启后优先将原始客户端的 `User-Agent` 转发给上游。
- 客户端未提供该请求头时，沿用自定义表单或 Provider 的默认配置。
- 该开关默认关闭。

### 5. 自定义 Provider 头像

- OpenAI Compatible、Anthropic Compatible 和 Custom Embedding 节点支持在新增或编辑时选择头像。
- 可从项目内置的 Provider 图标中搜索并选择，也可恢复默认头像。
- 所选头像同步显示在 Provider 列表和详情页，并随节点配置持久化保存。
