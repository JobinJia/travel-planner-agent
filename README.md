# Travel Planner Agent

补充文档：

- [AGENTS.md](/Users/jobin/myself/code-workspace/travel-planner-agent/AGENTS.md)
- [docs/PROJECT_CONTEXT.md](/Users/jobin/myself/code-workspace/travel-planner-agent/docs/PROJECT_CONTEXT.md)
- [docs/ARCHITECTURE.md](/Users/jobin/myself/code-workspace/travel-planner-agent/docs/ARCHITECTURE.md)

一个从 0 开始的 TypeScript 旅游规划助手项目，采用更适合复杂工作流的 `LangGraph` 架构：

- `TypeScript`
- `Node.js`
- `LangGraph.js`
- `OpenAI API`
- `Zod`
- `tsgo`（TypeScript Native Preview，可选）

这个项目现在同时提供：

- `CLI` 多轮交互
- `Fastify` HTTP API
- 浏览器单页前端

两者共用同一个 `LangGraph` 工作流，并通过多节点图流程完成：

- 收集偏好
- 澄清缺失信息
- 生成候选方案
- 比较预算与节奏
- 输出最终 itinerary
- 支持同一线程里的多轮修订

## 为什么改用 LangGraph

- `LangGraph.js`：更适合显式工作流、状态管理、多轮修订、人工介入和长期演进。
- `OpenAI API`：模型能力稳定，后续也容易接入 function/tool calling。
- `Zod`：定义工具输入结构时足够轻量，和 TypeScript 配合成熟。
- `tsgo`：微软官方的 TypeScript Native Preview，适合提早试验更快的类型检查和构建，但目前仍是 preview。

## 项目结构

```text
travel-planner-agent/
├── src/
│   ├── app/          # 共享 service 层
│   ├── graph/        # LangGraph 状态图与节点
│   ├── prompts/      # 各节点提示词
│   ├── tools/        # 预算/季节/打包等领域逻辑
│   ├── types/        # 领域类型
│   ├── index.ts      # CLI 入口
│   └── server.ts     # Fastify API 服务
├── .env.example
├── package.json
└── tsconfig.json
```

## 快速开始

```bash
cd travel-planner-agent
pnpm install
cp .env.example .env
```

在 `.env` 中填写：

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.4
AMAP_API_KEY=your_amap_api_key
```

如果你要直接用本地 Postgres 开发，先启动数据库：

```bash
docker compose up -d
```

启动 API 服务：

```bash
pnpm dev
```

默认监听：

```bash
http://localhost:3000
```

打开首页即可直接使用前端：

```bash
http://localhost:3000/
```

首页左侧会自动列出最近线程，点击即可恢复对应结果与 `thread_id`。
线程侧栏支持搜索和归档切换，适合长期保留多个旅行方案。
线程还支持归档 / 取消归档，避免历史列表越来越乱。

CLI 单次请求：

```bash
pnpm dev:cli -- --query "我想在 5 月和女朋友去日本玩 7 天，预算 2 万人民币，想要美食和城市漫游为主"
```

CLI 多轮交互：

```bash
pnpm dev:cli -- --thread demo-trip
```

同一个线程里你可以持续修订，例如：

- “预算降到 15000”
- “把节奏放慢一点”
- “想加入 2 天近郊自然景点”

如果你要复用同一条会话线程：

## API 示例

健康检查：

```bash
curl http://localhost:3000/health
```

数据库健康检查：

```bash
curl http://localhost:3000/health/db
```

查询指定坐标附近的美食：

```bash
curl "http://localhost:3000/api/pois/nearby?location=121.497253,31.238235&radius=1000"
```

如果你只有地点名，也可以先让服务端做地理编码，再查附近：

```bash
curl "http://localhost:3000/api/pois/nearby-by-address?address=%E4%B8%8A%E6%B5%B7%20%E5%A4%96%E6%BB%A9&radius=1000&keyword=%E7%BE%8E%E9%A3%9F"
```

如果你想指定关键词，也可以这样查：

```bash
curl "http://localhost:3000/api/pois/nearby?location=121.497253,31.238235&radius=1500&keyword=咖啡"
```

发起或续写一次规划：

```bash
curl -X POST http://localhost:3000/api/trips/plan \
  -H "content-type: application/json" \
  -d '{
    "threadId": "demo-trip",
    "message": "我想 5 月去日本玩 7 天，预算 2 万，偏美食和城市漫游"
  }'
```

基于已有线程做修订：

```bash
curl -X POST http://localhost:3000/api/trips/revise \
  -H "content-type: application/json" \
  -d '{
    "threadId": "demo-trip",
    "message": "预算降到 15000，并且想把节奏放慢一些"
  }'
```

如果返回 `requiresConfirmation: true`，说明这一轮不是最终定稿，而是需要你继续确认取舍。你可以继续回复：

- `保持不变`
- `压缩景点`
- `延长一天`
- `公交优先`

同时响应里会包含结构化的 `confirmationOptions`，前端可以直接把它渲染成按钮，而不必解析自然语言。

查看某个线程当前状态：

```bash
curl http://localhost:3000/api/trips/thread/demo-trip
```

## 当前能力

- 从多轮输入中累积旅行偏好
- 自动识别缺失信息与默认假设
- 生成 2 个候选方案并比较预算/节奏
- 输出最终推荐 itinerary
- 候选方案包含结构化 `dailyPlan`，便于逐日路线评估
- 提供季节建议与打包建议
- 可接入高德地点解析与 POI 搜索
- 支持按指定坐标搜索附近美食或其他 POI
- 可接入高德天气（实况 + 预报）
- 可接入高德路线规划并评估行程拥挤度
- 检测到高拥挤度时会进入确认节点，等待用户选择调整方向
- 通过 Fastify 暴露 HTTP API
- 提供浏览器单页交互界面，支持确认按钮直接回传
- 浏览器页面内置附近 POI 搜索面板，可直接联调高德周边搜索
- 前端支持会话历史、候选方案卡片与结构化日程浏览
- 前端支持线程历史侧栏与一键恢复最近线程
- 线程快照会持久化消息级历史，恢复时可看到每轮用户/agent 记录
- 线程侧栏支持搜索与归档，便于整理长期历史
- 提供 `plan` / `revise` 两类语义化接口
- 将线程结果快照持久化到本地文件，便于重启后查询
- 支持使用 Postgres 作为 LangGraph 原生 checkpointer

## tsgo 使用说明

这个项目保留标准 `typescript`，同时加入官方 preview 包 `@typescript/native-preview`。

标准 TypeScript：

```bash
pnpm typecheck
pnpm build
```

使用 `tsgo`：

```bash
pnpm typecheck:native
pnpm build:native
```

注意：`tsgo` 当前仍是 preview。适合试验和加速本地检查，但不要假定它已经 100% 兼容所有 TypeScript 工具链。

## Postgres 持久化

官方文档建议生产环境使用持久化 checkpointer：

- https://docs.langchain.com/oss/javascript/langgraph/persistence
- https://docs.langchain.com/oss/javascript/langgraph/add-memory
- https://langchain-ai.github.io/langgraphjs/reference/modules/checkpoint_postgres.html

本项目已经接入 Postgres checkpointer，核心代码在 [checkpointer.ts](/Users/jobin/myself/code-workspace/travel-planner-agent/src/graph/checkpointer.ts)。

本地开发可以直接使用 [docker-compose.yml](/Users/jobin/myself/code-workspace/travel-planner-agent/docker-compose.yml) 启动 Postgres：

```bash
docker compose up -d
docker compose ps
```

如果你要把 API 也一起容器化启动：

```bash
docker compose up -d --build
```

在 `.env` 中配置：

```bash
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/travel_planner?sslmode=disable
POSTGRES_SCHEMA=public
```

当 `POSTGRES_URL` 存在时：

- LangGraph 会使用 Postgres 保存线程状态
- 首次启动会自动执行建表初始化
- 同一个 `thread_id` 可以跨服务重启继续推理
- 默认 compose 配置会把数据保存在 Docker volume `postgres-data`

当 `POSTGRES_URL` 不存在时：

- 自动回退到 `MemorySaver`
- 只适合本地开发或临时调试

## 持久化说明

当前实现包含两层状态：

- `LangGraph checkpointer`：优先使用 Postgres，未配置时回退到 `MemorySaver`
- 线程消息历史：优先写入 Postgres，未配置时回退到本地快照
- 本地文件快照：默认写入 `.data/threads/*.json`，用于服务重启后的线程结果查询

这意味着：

- 配置 Postgres 后，可以跨服务重启继续原线程推理
- 服务重启后，仍然可以查询上一次保存的线程快照
- 如果数据库暂时不可用，仍有本地快照可用于查询结果

你也可以通过环境变量修改快照目录：

```bash
THREAD_SNAPSHOT_DIR=./.data/threads
```

## 本地开发推荐流程

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

验证数据库容器：

```bash
docker compose ps
docker compose logs postgres
```

验证服务：

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/db
```

如果你要直接运行完整容器栈：

```bash
docker compose up -d --build
docker compose logs app
```

## 下一步建议

- 接入航班、酒店、天气、地图等实时 API
- 增加 Docker Compose 本地 Postgres 开发环境
- 增加人工确认节点，比如“先确认预算后再出完整方案”
- 提供 Web API 或前端界面
