# GraphRAG Studio

[![Version](https://img.shields.io/badge/version-v1.4.0-00d9ff)](https://github.com/xuejingyang-ux/GraphRAG-Studio)
[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688)](https://fastapi.tiangolo.com/)
[![Tests](https://img.shields.io/badge/tests-41%20unit%20%2B%2016%20E2E-brightgreen)](#自动化验收)

GraphRAG Studio 是一个面向多知识库的 Agentic GraphRAG 系统。它将多格式文档索引为相互隔离但可统一管理的知识图谱，由 Supervisor 自动选择单个智能体，或在问题涉及多个知识库时并行调度多个专业智能体并综合答案。

当前版本：`v1.4.0`。后端采用 FastAPI，前端采用原生 HTML/CSS/JavaScript，图谱根据规模自动使用 D3 SVG 或 Canvas 渲染。

## 核心能力

- 多格式文档：支持 PDF、DOCX、PPTX、图片、HTML、TXT 和 Markdown 上传、解析与索引。
- 多知识库管理：文档、节点和关系使用 `kb_id` 隔离，每个知识库可以打开独立图谱。
- 智能体管理：支持修改系统提示词、绑定知识库、工具权限和联网权限，并可创建自定义智能体。
- 多智能体协同：Supervisor 自动识别跨知识库问题，并行委派专业智能体后综合可追溯答案。
- 对话级智能体记忆：后端按 `conversation_id + agent_id` 保存记忆，支持查看、复用和清除。
- 混合问答路由：知识库问题进入 GraphRAG/ReAct，实时问题联网检索，其余问题进入通用模型。
- 质量统计：按智能体统计调用次数、平均延迟，以及基于用户反馈的准确率。
- 知识图谱可视化：支持筛选、缩放、拖动、节点定位、邻居查询、路径搜索和 JSON/PNG 导出。

## 项目文档

- [产品需求文档](docs/product_requirements_document-v1.0.md)
- [后端接口规范](docs/backend_service_specification-v1.0.md)
- [前端设计规范](docs/frontend_design_specification-v1.0.md)
- [系统演示手册](docs/系统演示手册.md)

## 已实现功能

- Dashboard：系统统计、健康状态、最近文档、GraphRAG 与医疗 Demo 数据加载。
- Knowledge Bases：知识库 CRUD、占用保护、数据统计和独立图谱入口。
- Agents：智能体 CRUD、提示词/工具/联网权限配置、路由测试和调用质量统计。
- Documents：知识库选择、拖拽上传、格式校验、索引进度、取消、重试和结果摘要。
- KG Explorer：全局/独立图谱、D3 SVG/Canvas、自适应渲染、筛选、定位、详情和导出。
- QA Chat：单智能体问答、跨库多智能体协同、对话记忆、实时联网、Tool Calls、引用和反馈。
- Search：实体搜索、路径搜索、子图搜索。
- 自动化验收：41 项 Python 测试和 16 项 Playwright 浏览器测试。

## 运行步骤

```powershell
cd C:\Users\Lenovo\Documents\实训项目\GraphRAG-Studio
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn graphrag_pipeline.api_server:app --host 127.0.0.1 --port 8000 --reload
```

浏览器访问：

```text
http://127.0.0.1:8000
```

说明：`mineru[all]` 依赖较多，首次安装可能较慢。若课堂演示环境暂未安装 MinerU 或 LangExtract，系统会自动使用本地解析和规则抽取兜底，保证页面和接口可以运行。

## 配置

`.env` 支持：

```text
SILICONFLOW_API_KEY=你的 API key
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Pro/zai-org/GLM-5.1
SILICONFLOW_ENTITY_MODEL=Pro/zai-org/GLM-5.1
ENABLE_LANGEXTRACT=1
MINERU_BACKEND=pipeline
MINERU_TIMEOUT_SECONDS=240
HOST=127.0.0.1
PORT=8000
```

## 项目结构

```text
GraphRAG-Studio/
  docs/
  graphrag_pipeline/
    api_server.py
    data/
    static/app/
      index.html
      css/
      js/
  requirements.txt
  README.md
  .env.example
```

## API 分组

- 知识库与智能体：知识库/智能体 CRUD、工具配置、路由测试、调用统计。
- 文档管理：上传、列表、详情、删除。
- 索引任务：启动、状态、结果、取消。
- 知识图谱：节点、边、详情、邻居、统计、导出。
- QA 问答：同步/批量问答、多智能体协同、对话记忆、答案反馈、历史记录。
- 搜索：实体搜索、路径搜索、子图搜索。
- 系统：健康检查、统计、格式、Demo 数据。

## 数据说明

运行数据保存到 `graphrag_pipeline/data/store.json`，上传文件保存到 `graphrag_pipeline/data/uploads/`。提交作业时可以保留源码，按需清空 `data/` 中的运行文件。

“加载示例”会同时载入 GraphRAG 技术样例和 `sample_data/medical_knowledge_800.md` 医疗教学样例。医疗问答会根据问题需要分别组织疾病、症状、治疗、药物和科室邻居；未配置模型 API 时也会返回本地图谱中的结构化结果。

索引完成后，系统会自动重建全局类型骨架。例如“疾病”公共节点连接全部疾病实体，“药物”公共节点连接全部药物实体；所有类型公共节点再连接到“知识图谱总览”根节点。原有页面共现关系继续保留，因此图谱既能整体连通，也能表达局部知识关系。

结构化医疗文档还会抽取 `HAS_SYMPTOM`、`TREATED_WITH`、`VISITS_DEPARTMENT` 等语义关系；每条语义边保留页码和证据文本。问答在配置 API Key 时采用 LangChain 驱动的 ReAct 工具循环，没有模型时使用可重复测试的确定性 ReAct 回退，两种模式都会真实查询图谱并接收当前会话历史。

问答入口采用混合路由：已有实体问题优先使用知识图谱；包含“今天、最新、赛程、天气、股价”等实时意图的问题先联网检索并展示网页来源；其他未命中图谱的问题由通用大模型回答。响应中的 `answer_mode` 会明确标记 `knowledge_graph`、`web_search` 或 `general_llm`，避免混淆知识库事实和外部信息。

## 知识库与内置智能体

系统内置两个知识库和四个智能体：

| 智能体 | 绑定范围 | 用途 |
|---|---|---|
| 医疗知识智能体 | 医疗知识库 | 疾病、症状、药物、治疗和科室问答 |
| GraphRAG 技术智能体 | GraphRAG 技术知识库 | RAG、LangChain、解析和图谱技术问答 |
| 实时联网智能体 | 联网检索 | 赛程、天气、新闻等实时信息 |
| 通用问答智能体 | 通用模型 | 未命中知识库的非实时问题 |

上传文档时必须选择所属知识库，索引生成的文档、节点和关系都会保存 `kb_id`。知识库管理和智能体管理页面支持创建、编辑和安全删除自定义资源，修改系统提示词、工具权限、知识库绑定和联网权限。每张知识库卡片都能打开 `#/graph?kb_id=...` 独立图谱；节点详情、邻居、统计和 JSON 导出继续使用相同的 `kb_id` 作用域，避免跨库泄漏。

问答页面可以选择“自动选择（Supervisor）”或手动指定智能体；自动模式根据命中实体的知识库、实时关键词和通用回退进行路由。回答会显示 `agent_name`、`kb_name` 和 `route_reason`。智能体配置会进入实际执行链：图谱问答需要实体解析与邻居工具，联网问答同时要求联网权限和 `web_search` 工具，模型可用时使用对应智能体的系统提示词。

v1.4.0 增加多智能体协同：Supervisor 检测到问题同时涉及两个及以上知识库时，会分别委派绑定的专业智能体，再综合各自的可追溯结果；单库问题不会额外触发协同。`conversation_id` 对应的智能体记忆保存在后端，即使前端没有再次发送历史，也能解析“它、两者、上述”等追问。智能体管理页统计调用次数、平均延迟和基于用户“有帮助/不准确”反馈的准确率；没有有效评价时显示“暂无评价”，不生成虚假准确率。

## 自动化验收

```powershell
npm install
npx playwright install chromium
npm run lint
npm test
npm run test:e2e
```

- `tests/test_prd_acceptance.py`：逐项覆盖 F01–F15 的后端、接口契约和静态能力检查。
- `tests/test_phase3_collaboration.py`：覆盖跨知识库协同、对话级智能体记忆、反馈准确率和协同调用归因。
- `tests/e2e/acceptance.spec.js`：真实 Chromium 覆盖上传、图谱、单/多智能体问答、记忆、反馈、搜索、移动端及性能预算。
- Playwright 报告、截图、视频与 trace 统一输出到 `output/playwright/`。
