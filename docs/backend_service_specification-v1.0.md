# GraphRAG Studio Backend Service Specification v1.0

服务地址：`http://localhost:8000/api/v1`

统一响应：

```json
{"code":0,"msg":"ok","request_id":"...","data":{}}
```

错误响应同样使用统一结构，前端由 `APIError` 统一捕获。

## 文档管理

文档、索引生成的节点和关系均包含 `kb_id`。上传接口使用 multipart 字段 `kb_id` 指定目标知识库。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/documents/upload` | 上传文档，支持 PDF/DOCX/DOC/PPTX/PPT/PNG/JPG/JPEG/HTML/TXT/MD |
| GET | `/documents/{doc_id}` | 获取文档详情 |
| GET | `/documents` | 分页获取文档列表 |
| DELETE | `/documents/{doc_id}` | 删除文档及其图谱节点和边 |

## 知识库与智能体

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/knowledge-bases` | 获取知识库及文档、节点、关系统计 |
| POST/PATCH/DELETE | `/knowledge-bases[/{kb_id}]` | 创建、修改和删除空闲的自定义知识库；内置库与占用库受保护 |
| GET | `/agents` | 获取内置/自定义智能体、可选工具、绑定知识库及数据统计 |
| POST/PATCH/DELETE | `/agents[/{agent_id}]` | 创建、修改和删除自定义智能体；内置智能体可配置但不可删除 |
| POST | `/routing/test` | 只执行 Supervisor 路由判断，不调用大模型或联网服务 |
| GET | `/agent-stats` | 按智能体统计调用次数、用户反馈准确率和平均延迟 |

内置 `agent_medical`、`agent_technical`、`agent_web`、`agent_general`。每个智能体保存 `system_prompt`、`tools` 和 `allow_web_search`。`POST /query` 接受 `agent_id`、`kb_id` 和 `conversation_id`。自动模式会先计算路由计划：命中至少两个知识库时由 Supervisor 委派多个知识图谱智能体并综合结果，否则进入单智能体、联网或通用路径。智能体调用统计由查询日志中的 `agent_metrics` 聚合；准确率只统计已提交反馈的答案。

## 索引任务

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/index/start` | 启动索引任务 |
| GET | `/index/status/{job_id}` | 查询任务进度 |
| GET | `/index/result/{job_id}` | 获取索引结果 |
| DELETE | `/index/jobs/{job_id}` | 取消任务 |

## 知识图谱

图谱由三层关系共同组成：文档实体之间使用 `CO_OCCURS_IN` 保留页面或文本块共现；结构化医疗字段会生成 `HAS_SYMPTOM`、`DIAGNOSED_BY`、`TREATED_BY`、`TREATED_WITH`、`VISITS_DEPARTMENT`，普通文本中的明确关系动词会生成 `CAUSES`、`IS_A`、`TREATS`、`LOCATED_IN`、`ASSOCIATED_WITH`；系统使用 `HAS_KNOWLEDGE_BASE`、`HAS_CATEGORY` 和 `INSTANCE_OF` 构建“知识图谱总览 → 知识库 → 类型 → 实体”的全局骨架。语义边包含 `evidence`、`page` 和 `kb_id`，无法可靠判断的关系仍只保留为共现边。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/kg/nodes` | 节点列表 |
| GET | `/kg/edges` | 边列表 |
| GET | `/kg/nodes/{node_id}` | 节点详情；可用 `kb_id` 强制作用域 |
| GET | `/kg/nodes/{node_id}/neighbors` | 节点邻居；可用 `kb_id` 强制作用域 |
| GET | `/kg/stats` | 图谱统计 |
| GET | `/kg/export` | 导出全图或指定 `kb_id` 的独立图谱 JSON |

## QA 问答

`POST /query` 会合并最多 10 条前端历史与后端对话级智能体记忆，并采用混合路由。跨库响应使用 `answer_mode=multi_agent`，返回 `collaborating_agents`、`agent_metrics` 和委派工具轨迹；单库命中使用 LangChain/ReAct；实时问题联网检索；其他问题进入通用模型。没有 API Key 时保留确定性图谱回退。`tool_calls` 只记录动作与工具观察，不暴露模型内部思维链。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/query` | 同步问答 |
| POST | `/query/batch` | 批量问答 |
| GET | `/query/batch/{batch_id}` | 批量状态 |
| GET | `/query/history` | 问答历史 |
| POST | `/query/{query_id}/feedback` | 保存答案准确/不准确反馈，用于统计准确率 |
| GET/DELETE | `/conversations/{conversation_id}/memory` | 查看或清除当前对话的分智能体记忆 |

普通 API 的前端超时为 30 秒，`/query` 与 `/query/batch` 为 60 秒；超时统一转换为错误码 `4001`。

## 搜索

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/search/entities` | 实体搜索 |
| GET | `/search/path` | 路径搜索 |
| GET | `/search/graph` | 子图搜索；`include_neighbors=true` 时严格扩展匹配实体的一跳邻居，不经类型公共节点级联为全图 |

## 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/system/stats` | 系统统计 |
| GET | `/system/formats` | 支持格式 |
| GET | `/system/demo` | 加载 Demo 数据 |

## 错误码

| code | 含义 |
|---|---|
| 1001 | 参数校验失败 |
| 1002 | 文件格式不支持 |
| 1003 | 文件超过大小限制 |
| 1004 | 文件不存在 |
| 2001 | Job 不存在 |
| 2002 | Job 仍在运行 |
| 2003 | Job 已完成 |
| 3001 | 节点不存在 |
| 3002 | KG 为空 |
| 4001 | QA 执行失败 |
| 5000 | 服务器内部错误 |
