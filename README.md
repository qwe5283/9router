# 9Router

基于 [decolua/9router](https://github.com/decolua/9router) 的 rebase 分支，在保留上游功能的基础上，增强 OpenAI / Anthropic 兼容 Provider 的请求与响应控制。

- **上游仓库**：https://github.com/decolua/9router
- **当前仓库**：https://github.com/qwe5283/9router

## 快速开始

准备 Docker、Docker Compose 和 OpenSSL，以下命令在 Linux 或 WSL 的 Bash 终端中执行。选择一种部署方式即可；两种方式均会启动 9Router 和 Headroom，并将应用数据保存在 `9router-data` Docker volume 中。

### 方式一：克隆项目，本地构建

适合需要自行修改代码或部署本分支最新源码的场景，另需安装 Git 和 `sed`。

```bash
git clone https://github.com/qwe5283/9router.git
cd 9router
cp .env.example .env
chmod 600 .env

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
docker compose up -d --no-build --pull never
```

以上换源仅影响 APK 和 npm；如果 Docker Hub 或 GHCR 镜像拉取失败，还需在 Docker 中配置可信的镜像加速器或网络代理。

后续更新时，在项目目录执行：

```bash
git pull
docker compose up -d --build
```

使用国内构建源时，`git pull` 后重新执行上面的 `docker build` 和 `docker compose up -d --no-build --pull never` 命令。

### 方式二：仅创建配置文件，拉取镜像启动

无需克隆仓库或本地编译，只需创建 `.env` 和 `docker-compose.yml`。使用本项目已发布的阿里云 ACR 镜像，当前发布架构为 `linux/amd64`；其他架构可使用方式一本地构建，或自行配置容器模拟运行。

创建部署目录并生成 `.env`：

```bash
mkdir -p 9router-deploy
cd 9router-deploy

cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
INITIAL_PASSWORD=$(openssl rand -hex 16)
API_KEY_SECRET=$(openssl rand -hex 32)
MACHINE_ID_SALT=$(openssl rand -hex 32)
ENABLE_REQUEST_LOGS=false
OBSERVABILITY_ENABLED=true
AUTH_COOKIE_SECURE=false
REQUIRE_API_KEY=false
BASE_URL=http://localhost:20128
NEXT_PUBLIC_BASE_URL=http://localhost:20128
EOF
chmod 600 .env
```

在同一目录创建 `docker-compose.yml`，写入以下内容：

```yaml
services:
  9router:
    image: crpi-pmwtbactowtr55vh.cn-beijing.personal.cr.aliyuncs.com/qwe5283/9router:latest
    platform: linux/amd64
    container_name: 9router
    restart: always
    ports:
      - "20128:20128"
    volumes:
      - 9router-data:/app/data
    env_file:
      - .env
    environment:
      DATA_DIR: /app/data
      PORT: "20128"
      HOSTNAME: "0.0.0.0"
      NODE_ENV: production
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    container_name: headroom
    restart: always
    ports:
      - "127.0.0.1:8787:8787"

volumes:
  9router-data:
    name: 9router-data
```

拉取镜像并启动：

```bash
docker compose pull
docker compose up -d
```

需要固定版本时，将 `latest` 替换为已发布的镜像标签。后续更新时，在部署目录重新执行：

```bash
docker compose pull
docker compose up -d
```

### 配置说明与访问地址

两种方式的初始 Dashboard 登录密码均为 `.env` 中的 `INITIAL_PASSWORD`。首次生成后可打开 `.env` 查看；后续更新保留原有 `.env`，继续使用已有密码和密钥。请妥善保管该文件，不要提交或泄露其中的内容。

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

远程部署时，将访问地址及 `.env` 中的 `BASE_URL`、`NEXT_PUBLIC_BASE_URL` 改为实际地址；Headroom 的端口默认仅允许部署主机本地访问。

两种方式通用的管理命令：

```bash
# 查看启动状态
docker compose ps

# 查看日志
docker compose logs -f

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

关联 commit：

- [c1c88283](https://github.com/qwe5283/9router/commit/c1c882837cab2a358103c4e8c095927e93801cf5)：兼容 Provider 自定义请求头及内置请求头恢复。
- [bd53fea6](https://github.com/qwe5283/9router/commit/bd53fea679444bab1fd54388b9748c44cf1e6148)：客户端 User-Agent 复用开关，以及 Cursor、GitHub Copilot 和 Zed 的请求头支持。

### 2. 兼容 Provider 请求体透传

- 为 OpenAI Compatible 和 Anthropic Compatible Provider 增加“透传”开关。
- 开启后保留客户端原始请求体，仅替换为实际上游模型名。
- 跳过格式转换、请求规范化、工具去重、Provider Thinking 注入及 Token Saver 等请求改写。
- 原样转发上游 HTTP 或 SSE 响应，同时保留用量统计与请求日志。
- 使用时应确保客户端请求格式与上游接口一致；该模式默认关闭。

关联 commit：

- [dd9c82fe](https://github.com/qwe5283/9router/commit/dd9c82feccb1a946d4797439e55e40da6671f87a)：请求体透传开关、原始响应转发及用量记录。

### 3. 可配置的重试与回退策略

- 为兼容 Provider 增加“回退”开关，默认开启，保持上游默认行为。
- 关闭后仅请求当前账号和上游地址，不再执行同地址重试、备用地址切换、Token 刷新重试或多账号切换。
- 直接调用和单成员 Combo 仍按原始 HTTP 状态、响应头和响应体返回上游结果，包括 SSE 错误。
- 多成员 Combo 的模型切换独立于 Provider 回退开关：当前成员失败或未产生有效内容时，仍按 Combo 现有规则尝试后续成员；只关闭当前 Provider 内部的重试与账号回退。
- 原样返回上游响应的同时，继续记录请求状态和用量信息。
- 关闭回退后仍记录聊天请求的 HTTP、网络及可识别的 SSE 错误，将最近错误前 200 字符、错误码和时间保存到连接，供 Dashboard 展示；记录动作不新增冷却锁或触发 Provider 内重试、账号切换，后续成功请求可清除错误。

关联 commit：

- [d6524c27](https://github.com/qwe5283/9router/commit/d6524c27135fb370ee50d9a2b9a44c579a4437be)：Provider 回退开关和原始错误响应的初始实现；Combo 层行为以后续修复为准。
- [d5cde049](https://github.com/qwe5283/9router/commit/d5cde049b380f6cb87c7c2a68fd14b9d62d7621d)：补齐关闭回退后的 HTTP、网络和 SSE 错误记录，保留原始响应及后续成功清除错误的行为。
- 本次 Combo 回退解耦尚未提交：实现见 [Combo 路由](./open-sse/services/combo.js)，验证见 [Combo 回归测试](./tests/unit/combo-fallback-disabled.test.js) 和 [聊天入口回归测试](./tests/unit/chat-fallback-disabled-errors.test.js)。提交产生真实哈希后、推送前补齐 commit 链接。

### 4. 自定义 Provider 头像

- OpenAI Compatible、Anthropic Compatible 和 Custom Embedding 节点支持在新增或编辑时选择头像。
- 可从项目内置的 Provider 图标中搜索并选择，也可恢复默认头像。
- 所选头像同步显示在 Provider 列表和详情页，并随节点配置持久化保存。

关联 commit：

- [6fe15103](https://github.com/qwe5283/9router/commit/6fe151034527d419bd228c81a15c222f72b2aa10)：自定义 Provider 头像选择、持久化和界面展示。

### 5. Dashboard 登录历史记录

- 记录密码、OIDC 和 SAML 登录尝试，在个人资料页面展示最近 20 条记录，最多保留 1,000 条。
- 记录登录时间、结果、失败原因、登录方式、客户端 IP 和 User-Agent，不保存密码、Token 或身份提供商原始断言。
- 支持通过 `TRUSTED_PROXY_IPS` 配置可信反向代理 IP，使 Nginx / Docker 部署在登录记录和限流中使用真实客户端 IP，而非 Docker 网桥地址。

关联 commit：

- [b6e96aa9](https://github.com/qwe5283/9router/commit/b6e96aa97d7a3e47ecfb37f680d3d5f9d2ba73a1)：密码、OIDC 和 SAML 登录历史的记录与展示。
- [1b871584](https://github.com/qwe5283/9router/commit/1b8715846ed325360f2bc36e8491c58b2b7c1c38)：可信反向代理配置和真实客户端 IP 识别。

### 6. 请求日志与可观测性配置修复

- `ENABLE_REQUEST_LOGS` 仅控制请求调试日志，不再覆盖 Dashboard 的可观测性开关。
- 请求详情记录优先遵循 Dashboard 的 `enableObservability` 设置，未设置时使用 `OBSERVABILITY_ENABLED` 作为默认值。

关联 commit：

- [42df8882](https://github.com/qwe5283/9router/commit/42df8882880448dfc21bd80090096b649e39ed9d)：修复 `ENABLE_REQUEST_LOGS` 覆盖可观测性配置的问题。

### 7. 本地源码构建与 ACR 镜像发布

- Docker Compose 默认从当前源码构建 `9router:local` 镜像，使部署包含本分支的功能变更。
- 本机部署定制放入不纳入版本控制的 `docker-compose.override.yml`，避免将主机配置带入仓库。
- 支持手动触发 GitHub Actions 构建 `linux/amd64` 镜像，通过容器健康检查后发布到阿里云 ACR，同时更新指定标签和 `latest`，并校验两者指向同一镜像。
- Docker 构建支持通过 `BUILD_NODE_OPTIONS` 单独设置编译阶段的 Node.js 参数。
- Docker 构建上下文排除各级 `node_modules` 和本机 `.scratch` 目录，避免打包本地依赖和临时文件。

关联 commit：

- [1a7d7f65](https://github.com/qwe5283/9router/commit/1a7d7f658dd9d4f6010b70114cc359edfc8f7ee0)：Compose 改为本地源码构建，并补充随机密码和密钥生成步骤。
- [36df3a7a](https://github.com/qwe5283/9router/commit/36df3a7aaa63ed704972207e2f3b03dddb6adc35)：将本机配置移入不纳入版本控制的 Compose override 文件。
- [fcd16f57](https://github.com/qwe5283/9router/commit/fcd16f572125d59ec6ff6a99f657a336692ee93e)：手动构建、检查并发布 ACR 镜像，以及 `BUILD_NODE_OPTIONS` 构建参数。
- [c6d7ade9](https://github.com/qwe5283/9router/commit/c6d7ade9b519193e44a13291dc06db33f357a6d6)：补充本地构建与仅创建配置文件拉取镜像的两种部署说明。
- [48c7f428](https://github.com/qwe5283/9router/commit/48c7f42818430cc1a77feeeca947d8adf0ad2a05)：补齐各级依赖目录和本机 `.scratch` 的 Docker 构建忽略规则。

### 8. Agnes 图像生成与 CN 渠道

- 在文本转图像列表中增加 Agnes AI 和 Agnes AI CN，预设供应商由 27 个增至 29 个；使用模型 `agnes/agnes-image-2.5-flash` 或 `agnes-cn/agnes-image-2.5-flash`，分别复用对应供应商的 API Key 连接。
- Agnes AI CN 使用独立供应商 ID `agnes-cn`，共享 Agnes AI 的聊天模型、图像模型和请求适配；官网、Key 管理、聊天、图像、连接测试和模型列表地址的域名均由 `agnes-ai.com` 改为 `agnes-ai.cn`，保留原子域名与路径。两者的连接和 API Key 分开配置。
- 通过 `POST /v1/images/generations` 支持文生图、参考图编辑与多图合成，默认生成一张 `1K`、`1:1` 图片，返回图片 URL。
- Dashboard 示例支持选择 `1K` / `2K` / `3K` / `4K`、八种宽高比、URL / Base64 输出，以及填写单张参考图 URL / Data URI；API 多图输入使用 `image` 数组或 `extra_body.image`，支持公共图片 URL 和 Data URI。
- 自动将客户端的 `response_format` 转为 Agnes 要求的 `extra_body.response_format`；文生图 Base64 输出同时设置 `return_base64: true`。兼容精确像素尺寸，但 Agnes 可能将其标准化；每次请求仅支持一张输出图片，`n` 省略或为 `1`。
- 接口行为依据 [Agnes Image 2.5 Flash 官方文档](https://www.agnes-ai.com/zh-Hans/docs/agnes-image-25-flash)。

关联 commit：

- [29b8cc58](https://github.com/qwe5283/9router/commit/29b8cc58ae73e7e65fc97eb62ae9958509e11642)：Agnes 图像供应商与模型配置、请求格式适配、Dashboard 尺寸和宽高比选择，以及渠道回归测试。
- [7cef5691](https://github.com/qwe5283/9router/commit/7cef56910d26284a687b47f217e92114ec733da4)：新增 Agnes AI CN，复用 Agnes 的模型配置与图像适配，补齐 CN 连接测试、模型发现和图标，并验证两个渠道的相同行为。

## 常见问题（Q&A）

### 1. 开启透传、关闭回退会如何影响 Combo？

“透传”和“回退”是两个独立开关：

- **只开启透传，保持回退开启**：当前 Provider 失败后，Combo 仍可切换到后续模型。若后续节点也开启透传，它们收到的同样是原始请求体，因此客户端请求格式必须与相应上游接口兼容。
- **开启透传并关闭回退**：当前 Provider 不再进行同地址重试、备用地址切换、失败后的 Token 刷新重试或多账号切换；多成员 Combo 仍按现有错误和空响应规则尝试后续模型。
- 关闭 Provider 回退不会取消 Combo 对本次请求起始模型的轮询、粘性或 Smart 选择，也不会禁止 Combo 层的模型切换。

需要原始厂商字段和单节点错误响应时，可以关闭 Provider 回退；同时使用多成员 Combo 时，最终响应仍由组合规则决定，无需为了 Combo 容灾开启 Provider 内部回退。

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

不会。Provider 的回退开关仅控制该 Provider 内部的重试和账号切换，多成员 Combo 独立决定是否尝试后续成员：

```text
Combo：A（Provider 回退开启） → B（Provider 回退关闭） → C（Provider 回退开启）
```

- A 返回可回退的错误：继续尝试 B。
- B 返回符合 Combo 回退规则的 HTTP 错误：继续尝试 C；不会因此恢复 B 内部的重试或多账号切换。
- B 的 SSE 在输出有效内容前结束且没有有效内容，或 JSON 响应为空：按 Combo 既有空响应规则决定是否尝试 C。
- B 已输出有效内容：返回 B；流式响应开始输出有效内容后发生的错误，不再切换到 C。内容过滤等原有不重试规则继续生效。

直接调用以及只有一个成员的 Combo 保持原有行为：关闭 Provider 回退后原样返回该节点的响应，不额外探测 SSE 内容。多成员 Combo 的全部失败结果按组合原有规则返回，不保证原样返回某个成员的错误。`fusion` 采用独立的并行汇总流程，不适用以上逐个切换规则。

**安全提示**：原样透传上游错误可能将厂商诊断信息暴露给客户端；对外提供服务前，应确认客户端有权查看这些信息。
