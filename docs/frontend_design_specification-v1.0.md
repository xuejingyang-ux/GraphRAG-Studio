# GraphRAG Studio Frontend Design Specification v1.0

前端采用原生 HTML/CSS/JS 与 Hash Router，无构建工具。

## 页面

- `#/dashboard`：系统总览、健康状态、最近文档、快捷入口。
- `#/documents`：选择所属知识库、文件上传、行内校验、列表筛选、文档详情、索引任务管理和结果摘要。
- `#/graph`：D3 知识图谱、筛选、详情、导出；≤500 节点使用 SVG，>500 节点自动切换 Canvas。
- `#/chat`：支持 Supervisor 自动路由或手动选择四个内置智能体，展示知识库、路由原因、知识图谱 ReAct、实时联网检索、通用大模型、批量问答、Tool Calls、Cited Nodes 和网页来源。
- `#/search`：实体搜索、路径搜索、子图搜索；子图搜索自动居中高亮首个匹配实体，并支持点击匹配标签重新定位。
- `#/system`：系统健康、支持格式、API 覆盖。

## 全局布局

使用 CSS Grid：

```css
.app {
  grid-template-areas: "header header" "sidebar main" "footer footer";
  grid-template-columns: var(--sidebar-w, 220px) 1fr;
  grid-template-rows: 56px 1fr 32px;
}
```

## UI 风格

- 基础配色遵循 GitHub Dark：`#0f1117`、`#161b22`、`#21262d`、`#30363d`。
- 强调色延续前序作业界面：青色 `#00f5ff`、蓝色 `#58a6ff`、紫粉 `#ff3df2`。
- 背景包含网格和 Canvas 粒子动效。
- 卡片半透明暗色玻璃质感，按钮使用青紫渐变作为主操作。

## 响应式

- `>1280px`：完整 Sidebar + Main。
- `1024-1280px`：Sidebar 折叠为图标模式。
- `<1024px`：Sidebar Drawer。
- `<768px`：底部 Tab Bar，表格转卡片，图谱详情下移。

## 可访问性

- 所有主要按钮提供文本或 `aria-label`。
- Toast 使用 `aria-live="polite"`。
- 表单控件支持键盘 Enter/Esc/Tab 操作。

## JS 模块

- `api.js`：27 个 API 调用和 `APIError`。
- `state.js`：全局 `AppState` 和事件总线。
- `ui.js`：Toast、Modal、格式化、粒子背景。
- `graph.js`：D3 SVG/Canvas 自适应图谱渲染、节点高亮、拖动、缩放和导出。
- `pages.js`：五个主页面和 System 页渲染。
- `router.js`：Hash 路由与全局搜索。
- `main.js`：应用初始化。
