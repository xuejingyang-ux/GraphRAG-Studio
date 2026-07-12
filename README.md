# GraphRAG Studio

GraphRAG Studio 是一个按 PRD 实现的知识图谱增强 RAG 系统，包含 FastAPI 后端和原生 HTML/CSS/JS 单页前端。

## 项目文档

- [项目详细说明文档](docs/项目详细说明文档.md)：前后端技术、技术路线图、系统架构、功能模块、业务流程、数据设计、API、安装运行、验收与扩展方向。
- [答辩 PPT 需求文档](docs/答辩PPT需求文档.md)：逐页内容要求、技术路线、视觉规范、演示方案、备用页和答辩问题。
- [产品需求文档](docs/product_requirements_document-v1.0.md)
- [后端接口规范](docs/backend_service_specification-v1.0.md)
- [前端设计规范](docs/frontend_design_specification-v1.0.md)

## 已实现功能

- Dashboard：系统统计、健康状态、最近文档、GraphRAG 与医疗 Demo 数据加载。
- Documents：拖拽/点击上传、格式与大小校验、索引任务启动、轮询进度、取消、删除。
- KG Explorer：D3 力导向图、类型/文档/置信度筛选、节点高亮、详情面板、邻居查看、PNG/JSON 导出。
- 全局图谱骨架：通过“知识图谱总览 → 类型公共节点 → 实体节点”连接所有子图，避免不同文档或页面形成孤立块。
- QA Chat：实体提及与泛化疾病名召回、按问题意图扩展图邻居、离线结构化回答、thinking 动画、Tool Calls 折叠面板、Cited Nodes 跳转。
- Search：实体搜索、路径搜索、子图搜索。
- 后端 API：按 PRD 封装 25 个 `/api/v1` 接口，统一返回 `{code,msg,request_id,data}`。
- 加分扩展：Demo 数据集、一键图谱导出、批量问答接口、规则兜底实体抽取、暗色粒子动效界面。

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

- 文档管理：上传、列表、详情、删除。
- 索引任务：启动、状态、结果、取消。
- 知识图谱：节点、边、详情、邻居、统计、导出。
- QA 问答：同步问答、批量问答、批量状态、历史。
- 搜索：实体搜索、路径搜索、子图搜索。
- 系统：健康检查、统计、格式、Demo 数据。

## 数据说明

运行数据保存到 `graphrag_pipeline/data/store.json`，上传文件保存到 `graphrag_pipeline/data/uploads/`。提交作业时可以保留源码，按需清空 `data/` 中的运行文件。

“加载示例”会同时载入 GraphRAG 技术样例和 `sample_data/medical_knowledge_800.md` 医疗教学样例。医疗问答会根据问题需要分别组织疾病、症状、治疗、药物和科室邻居；未配置模型 API 时也会返回本地图谱中的结构化结果。

索引完成后，系统会自动重建全局类型骨架。例如“疾病”公共节点连接全部疾病实体，“药物”公共节点连接全部药物实体；所有类型公共节点再连接到“知识图谱总览”根节点。原有页面共现关系继续保留，因此图谱既能整体连通，也能表达局部知识关系。

结构化医疗文档还会抽取 `HAS_SYMPTOM`、`TREATED_WITH`、`VISITS_DEPARTMENT` 等语义关系；每条语义边保留页码和证据文本。问答在配置 API Key 时采用 LangChain 驱动的 ReAct 工具循环，没有模型时使用可重复测试的确定性 ReAct 回退，两种模式都会真实查询图谱并接收当前会话历史。

问答入口采用混合路由：已有实体问题优先使用知识图谱；包含“今天、最新、赛程、天气、股价”等实时意图的问题先联网检索并展示网页来源；其他未命中图谱的问题由通用大模型回答。响应中的 `answer_mode` 会明确标记 `knowledge_graph`、`web_search` 或 `general_llm`，避免混淆知识库事实和外部信息。

## 自动化验收

```powershell
npm install
npx playwright install chromium
npm run lint
npm test
npm run test:e2e
```

- `tests/test_prd_acceptance.py`：逐项覆盖 F01–F15 的后端、接口契约和静态能力检查。
- `tests/e2e/acceptance.spec.js`：真实 Chromium 覆盖上传行内错误、索引摘要、多轮问答、搜索、批量问答、>500 节点 Canvas、767px 移动端及 40 节点/780 边性能预算。
- Playwright 报告、截图、视频与 trace 统一输出到 `output/playwright/`。
