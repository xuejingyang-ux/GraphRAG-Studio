const main = () => $("#main");
let activeGraph = null;
let previewGraph = null;

async function refreshShellStats() {
  try {
    const [stats, health] = await Promise.all([api.systemStats(), api.health()]);
    AppState.stats = stats;
    AppState.health = health;
    $("#documents-badge").textContent = stats.documents;
    $("#chat-badge").textContent = stats.queries;
    const ok = health.status === "ok";
    $("#health-dot").className = `status-dot ${ok ? "status-ok" : "status-warn"}`;
    $("#footer-health-dot").className = `status-dot ${ok ? "status-ok" : "status-warn"}`;
    $("#health-label").textContent = ok ? "API: localhost:8000" : "API: degraded";
  } catch (error) {
    $("#health-dot").className = "status-dot status-error";
    $("#footer-health-dot").className = "status-dot status-error";
    $("#health-label").textContent = "API: offline";
  }
}

async function loadDocuments(pageSize = 50) {
  const payload = await api.listDocuments({ page_size: pageSize });
  AppState.documents = payload.items;
  return payload;
}

async function loadKg(force = false) {
  if (AppState.kg.loaded && !force) return AppState.kg;
  const [nodesPayload, edgesPayload] = await Promise.allSettled([
    api.listNodes({ page_size: 5000 }),
    api.listEdges({ page_size: 20000 }),
  ]);
  AppState.kg.nodes = nodesPayload.status === "fulfilled" ? nodesPayload.value.items : [];
  AppState.kg.edges = edgesPayload.status === "fulfilled" ? edgesPayload.value.items : [];
  AppState.kg.loaded = true;
  return AppState.kg;
}

function trackJob(job) {
  if (!job?.job_id || AppState.activeJobs[job.job_id]) return;
  const updateStatus = (current) => {
    const status = $("#active-job-status");
    if (!status) return;
    if (current?.status === "indexing") {
      status.classList.remove("hidden");
      status.textContent = `Indexing ${current.doc_id}... ${current.progress || 0}% · ${current.stage}`;
    } else {
      status.classList.add("hidden");
    }
  };
  updateStatus(job);
  AppState.activeJobs[job.job_id] = setInterval(async () => {
    try {
      const current = await api.getIndexStatus(job.job_id);
      updateStatus(current);
      Events.emit("job:update", current);
      if (!["indexing", "queued"].includes(current.status)) {
        clearInterval(AppState.activeJobs[job.job_id]);
        delete AppState.activeJobs[job.job_id];
        if (current.status === "done") {
          const result = await api.getIndexResult(job.job_id);
          current.result = result;
          const documentItem = AppState.documents.find((item) => item.doc_id === current.doc_id);
          if (documentItem) documentItem.result = result;
          AppState.kg.loaded = false;
          toast(`索引完成：${result.nodes} nodes · ${result.edges} edges`, "success");
        } else if (current.status === "failed") {
          toast(current.message || "Indexing failed", "error");
        }
        await refreshShellStats();
        Events.emit("documents:refresh");
      }
    } catch (error) {
      clearInterval(AppState.activeJobs[job.job_id]);
      delete AppState.activeJobs[job.job_id];
      showError(error, "轮询任务失败");
    }
  }, 3000);
}

function resultSummary(result) {
  if (!result) return "";
  return `<div class="index-result" data-testid="index-result">${Number(result.nodes || 0)} nodes · ${Number(result.edges || 0)} edges · ${Number(result.pages || 0)} pages · ${Number(result.extractions || 0)} extractions · ${Number(result.duration || 0)}s</div>`;
}

async function renderDashboard() {
  main().className = "main";
  main().innerHTML = pageHead(
    "系统总览",
    "系统总览、健康状态、最近文档和快捷入口。",
    '<button class="btn btn-primary" id="load-demo-btn">加载示例</button><a class="btn btn-secondary" href="#/documents">上传文档</a>',
  ) + `
    <section class="grid metrics-grid" id="metric-grid">
      ${[1, 2, 3, 4].map(() => '<div class="card metric-card"><div class="skeleton"></div><br><div class="skeleton"></div></div>').join("")}
    </section>
    <section class="two-column" style="margin-top:16px">
      <div class="card glow">
        <div class="toolbar"><h2 style="margin-right:auto">最近文档</h2><a class="btn btn-sm btn-secondary" href="#/documents">查看全部 →</a></div>
        <div id="recent-docs"></div>
      </div>
      <div class="grid">
        <div class="card glow"><h2>系统健康</h2><div id="health-panel"></div></div>
        <div class="card glow"><h2>快捷操作</h2><div class="toolbar">
          <a class="btn btn-primary" href="#/documents">上传并索引</a>
          <a class="btn btn-secondary" href="#/graph">打开图谱</a>
          <a class="btn btn-secondary" href="#/chat">智能问答</a>
          <a class="btn btn-secondary" href="#/search">知识搜索</a>
        </div></div>
      </div>
    </section>
  `;
  $("#load-demo-btn").addEventListener("click", async () => {
    try {
      await api.loadDemo();
      AppState.kg.loaded = false;
      toast("Demo 数据已加载", "success");
      await renderDashboard();
    } catch (error) {
      showError(error, "加载 Demo 失败");
    }
  });
  try {
    const [stats, health, docs] = await Promise.all([api.systemStats(), api.health(), api.listDocuments({ page_size: 5 })]);
    $("#metric-grid").innerHTML = [
      ["知识节点", stats.nodes, "知识节点", "var(--blue)"],
      ["知识关系", stats.edges, "语义关系", "var(--purple)"],
      ["文档数量", stats.documents, "文档总数", "var(--green)"],
      ["问答次数", stats.queries, "问答次数", "var(--yellow)"],
    ]
      .map(([label, value, sub, color]) => `<div class="card metric-card"><div class="metric-label">${label}</div><div class="metric-value" style="color:${color}">${value}</div><div class="metric-sub">${sub}</div></div>`)
      .join("");
    $("#health-panel").innerHTML = Object.entries(health.services)
      .map(([name, service]) => `<div class="toolbar" style="justify-content:space-between"><span>${escapeHtml(name)}</span><span class="badge ${service.ok ? "indexed" : "failed"}">● ${service.ok ? "ok" : "error"}</span></div><p class="small">${escapeHtml(service.detail)}</p>`)
      .join("");
    $("#recent-docs").innerHTML = renderDocsTable(docs.items.slice(0, 5), true);
    await refreshShellStats();
  } catch (error) {
    showError(error, "Dashboard 加载失败");
  }
}

function renderDocsTable(docs, compact = false) {
  if (!docs.length) {
    return emptyState("暂无文档", "点击上传区导入 PDF、DOCX、PPTX、图片或 HTML。", '<a class="btn btn-primary" href="#/documents">上传并索引 →</a>');
  }
  if (compact) {
    return docs
      .map((doc) => `
        <div class="toolbar" style="justify-content:space-between;border-bottom:1px solid var(--border-muted);padding:10px 0">
          <div><strong>${escapeHtml(doc.filename)}</strong><div class="small">${escapeHtml((doc.format || "").toUpperCase())} · ${doc.pages || "—"} pages · ${formatBytes(doc.size)}</div></div>
          <div style="min-width:150px">${statusBadge(doc.status)}<div style="margin-top:6px">${progressBar(doc.progress || 0)}</div><div class="small">${escapeHtml(doc.stage || "")}</div></div>
        </div>
      `)
      .join("");
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>文件</th><th>格式</th><th>页数</th><th>状态</th><th>日期</th>${compact ? "" : "<th>操作</th>"}</tr></thead>
        <tbody>${docs
          .map((doc) => `
            <tr data-doc-id="${escapeHtml(doc.doc_id)}" data-job-id="${escapeHtml(doc.job_id || "")}">
              <td><strong>${escapeHtml(doc.filename)}</strong><div class="small">${formatBytes(doc.size)}</div>${doc.error ? `<div class="small" style="color:var(--red)">${escapeHtml(doc.error)}</div>` : ""}</td>
              <td>${escapeHtml((doc.format || "").toUpperCase())}</td>
              <td>${doc.pages || "—"}</td>
              <td>${statusBadge(doc.status)}<div style="margin-top:6px">${progressBar(doc.progress || 0)}</div><div class="small">${escapeHtml(doc.stage || "")}</div>${resultSummary(doc.result)}</td>
              <td>${escapeHtml((doc.uploaded_at || "").slice(0, 19).replace("T", " "))}</td>
              ${compact ? "" : `<td><div class="toolbar">
                ${doc.status === "uploaded" || doc.status === "failed" ? `<button class="btn btn-sm btn-primary" data-action="index" data-doc="${doc.doc_id}">▶ 开始索引</button>` : ""}
                ${doc.status === "indexing" ? `<button class="btn btn-sm btn-secondary" data-action="cancel-doc" data-doc="${doc.doc_id}" data-job="${doc.job_id || ""}">✕ 取消任务</button>` : ""}
                ${doc.status === "indexed" ? `<a class="btn btn-sm btn-secondary" href="#/graph?doc_id=${encodeURIComponent(doc.doc_id)}">◉ 查看图谱</a>` : ""}
                <button class="btn btn-sm btn-secondary" data-action="details" data-doc="${doc.doc_id}">详情</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-doc="${doc.doc_id}">删除</button>
              </div></td>`}
            </tr>
          `)
          .join("")}</tbody>
      </table>
    </div>
  `;
}

function validateFile(file) {
  const allowed = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".png", ".jpg", ".jpeg", ".html"];
  const ext = `.${file.name.split(".").pop().toLowerCase()}`;
  if (!allowed.includes(ext)) return `不支持的文件格式：${ext}`;
  if (file.size > 200 * 1024 * 1024) return "文件超过 200MB 限制";
  return "";
}

async function renderDocuments() {
  main().className = "main";
  main().innerHTML = pageHead("文档管理", "上传、索引、监控和管理知识文档。") + `
    <section class="card glow">
      <div class="upload-zone" id="upload-zone">
        <input id="file-input" type="file" multiple accept=".pdf,.docx,.doc,.pptx,.ppt,.png,.jpg,.jpeg,.html" />
        <div><div class="upload-icon">⇧</div><h2>将文件拖放到此处</h2><p class="small">PDF · DOCX · DOC · PPTX · PPT · PNG · JPG · HTML · 单文件最大 200MB</p><button class="btn btn-primary" type="button">选择文件</button></div>
      </div>
      <div class="upload-results" id="upload-results" aria-live="polite"></div>
    </section>
    <section class="card glow" style="margin-top:16px">
      <div class="toolbar">
        <select class="select" id="format-filter" style="max-width:160px"><option value="All">全部格式</option><option>.pdf</option><option>.docx</option><option>.pptx</option><option>.png</option><option>.jpg</option><option>.html</option></select>
        <select class="select" id="status-filter" style="max-width:180px"><option value="All">全部状态</option><option value="indexed">已索引</option><option value="indexing">索引中</option><option value="uploaded">已上传</option><option value="failed">失败</option></select>
        <input class="input" id="doc-keyword" placeholder="Filter documents..." style="max-width:280px" />
        <button class="btn btn-secondary" id="refresh-docs">刷新</button>
      </div>
      <div id="documents-table"></div>
    </section>
  `;

  const zone = $("#upload-zone");
  const input = $("#file-input");
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    await uploadFiles(Array.from(event.dataTransfer.files || []));
  });
  input.addEventListener("change", async () => uploadFiles(Array.from(input.files || [])));
  $("#refresh-docs").addEventListener("click", refreshDocumentsTable);
  $("#format-filter").addEventListener("change", refreshDocumentsTable);
  $("#status-filter").addEventListener("change", refreshDocumentsTable);
  $("#doc-keyword").addEventListener("input", refreshDocumentsTable);
  Events.on("documents:refresh", refreshDocumentsTable);
  await refreshDocumentsTable();
}

async function uploadFiles(files) {
  const resultRoot = $("#upload-results");
  if (resultRoot) resultRoot.innerHTML = "";
  for (const file of files) {
    const error = validateFile(file);
    if (error) {
      resultRoot?.insertAdjacentHTML("beforeend", `<div class="upload-result error"><strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(error)}</span></div>`);
      continue;
    }
    const rowId = `upload-${Math.random().toString(36).slice(2)}`;
    resultRoot?.insertAdjacentHTML("beforeend", `<div class="upload-result" id="${rowId}"><strong>${escapeHtml(file.name)}</strong><span>上传中…</span></div>`);
    try {
      const doc = await api.uploadDocument(file);
      $(`#${rowId} span`)?.replaceChildren(document.createTextNode("上传成功"));
      toast(`${doc.filename} uploaded`, "success");
      const yes = await confirmModal("现在开始索引吗？", `${doc.filename} 已上传。`, "是，开始索引");
      if (yes) {
        const job = await api.startIndex(doc.doc_id);
        trackJob(job);
      }
    } catch (uploadError) {
      $(`#${rowId}`)?.classList.add("error");
      $(`#${rowId} span`)?.replaceChildren(document.createTextNode(uploadError.message || "上传失败"));
      showError(uploadError, `${file.name} 上传失败`);
    }
  }
  await refreshDocumentsTable();
  await refreshShellStats();
}

async function refreshDocumentsTable() {
  try {
    const payload = await loadDocuments();
    const format = $("#format-filter")?.value || "All";
    const status = $("#status-filter")?.value || "All";
    const keyword = ($("#doc-keyword")?.value || "").toLowerCase();
    const docs = payload.items.filter((doc) => {
      if (format !== "All" && doc.format !== format) return false;
      if (status !== "All" && doc.status !== status) return false;
      if (keyword && !doc.filename.toLowerCase().includes(keyword)) return false;
      return true;
    });
    $("#documents-table").innerHTML = renderDocsTable(docs);
    bindDocumentActions();
  } catch (error) {
    showError(error, "文档列表加载失败");
  }
}

function bindDocumentActions() {
  $$('[data-action="details"]').forEach((button) => {
    button.addEventListener("click", () => showDocumentDetails(button.dataset.doc));
  });
  $$("[data-action='index']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const job = await api.startIndex(button.dataset.doc);
        trackJob(job);
        await refreshDocumentsTable();
      } catch (error) {
        showError(error, "启动索引失败");
      }
    });
  });
  $$("[data-action='cancel-doc']").forEach((button) => {
    button.addEventListener("click", async () => {
      const doc = AppState.documents.find((item) => item.doc_id === button.dataset.doc);
      const yes = await confirmModal("取消索引任务？", `终止 ${doc?.filename || button.dataset.doc} 的索引任务。`, "终止任务", true);
      if (!yes) return;
      try {
        const jobs = await Promise.allSettled(Object.keys(AppState.activeJobs).map((jobId) => api.getIndexStatus(jobId)));
        const matched = jobs.find((item) => item.status === "fulfilled" && item.value.doc_id === button.dataset.doc)?.value;
        await api.cancelJob(button.dataset.job || matched?.job_id);
        await refreshDocumentsTable();
      } catch (error) {
        showError(error, "取消任务失败");
      }
    });
  });
  $$("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      const yes = await confirmModal("删除文档？", "删除后会同时移除相关图谱节点和关系。", "删除", true);
      if (!yes) return;
      try {
        await api.deleteDocument(button.dataset.doc);
        AppState.kg.loaded = false;
        toast("Document deleted", "success");
        await refreshDocumentsTable();
        await refreshShellStats();
      } catch (error) {
        showError(error, "删除文档失败");
      }
    });
  });
}

async function showDocumentDetails(docId) {
  try {
    const doc = await api.getDocument(docId);
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="文档详情">
        <div class="modal"><h2>${escapeHtml(doc.filename)}</h2>
          <p class="small">${escapeHtml(doc.doc_id)} · ${escapeHtml(doc.format)} · ${formatBytes(doc.size)}</p>
          <p>${statusBadge(doc.status)} ${escapeHtml(doc.stage || "")}</p>
          ${resultSummary(doc.result)}
          <div class="modal-actions"><button class="btn btn-primary" data-action="close">关闭</button></div>
        </div>
      </div>`;
    root.querySelector('[data-action="close"]').addEventListener("click", () => (root.innerHTML = ""));
  } catch (error) {
    showError(error, "文档详情加载失败");
  }
}

async function renderGraphPage(params = {}) {
  main().className = "main graph-page";
  main().innerHTML = `
    <section class="graph-layout">
      <aside class="filter-panel">
        <div class="panel-section"><span class="eyebrow">KG Explorer</span><h2>筛选</h2></div>
        <div class="panel-section"><h3>来源文档</h3><select class="select" id="graph-doc-filter"><option value="">全部文档</option></select></div>
        <div class="panel-section"><h3>实体类型</h3><div class="check-list" id="type-filters"></div></div>
        <div class="panel-section"><h3>置信度</h3><div class="check-list" id="confidence-filters"></div></div>
        <div class="panel-section"><button class="btn btn-secondary" id="export-png">导出 PNG</button> <button class="btn btn-secondary" id="export-json">导出 JSON</button></div>
      </aside>
      <div class="graph-canvas" id="kg-canvas">
        <div class="graph-toolbar">
          <button class="icon-btn" id="zoom-in" aria-label="Zoom in">+</button>
          <button class="icon-btn" id="zoom-out" aria-label="Zoom out">−</button>
          <button class="btn btn-secondary btn-sm" id="fit-graph">⊡ 适配</button>
          <input class="input" id="graph-search" placeholder="搜索节点..." style="width:220px" />
          <span class="badge" id="graph-runtime">加载中…</span>
        </div>
        <div class="legend" id="graph-legend"></div>
      </div>
      <aside class="detail-panel" id="detail-panel"><div class="panel-section">${emptyState("选择节点", "点击图谱节点查看详情、邻居和智能问答。")}</div></aside>
    </section>
  `;
  renderLegend("#graph-legend");
  try {
    const [, , kgStats] = await Promise.all([loadDocuments(), loadKg(true), api.getKgStats()]);
    $("#graph-runtime").textContent = `${kgStats.nodes} nodes · ${kgStats.edges} edges`;
    const docSelect = $("#graph-doc-filter");
    docSelect.innerHTML += AppState.documents.map((doc) => `<option value="${doc.doc_id}">${escapeHtml(doc.filename)}</option>`).join("");
    if (params.doc_id) docSelect.value = params.doc_id;
    const typeCounts = AppState.kg.nodes.reduce((acc, node) => ({ ...acc, [node.type]: (acc[node.type] || 0) + 1 }), {});
    $("#type-filters").innerHTML = Object.entries(TypeColors).map(([type]) => `<label><input type="checkbox" value="${type}" checked /> ${type} <span class="small">(${typeCounts[type] || 0})</span></label>`).join("");
    $("#confidence-filters").innerHTML = ["exact", "greater", "lesser", "fuzzy"].map((value) => `<label><input type="checkbox" value="${value}" checked /> ${value}</label>`).join("");
    const redraw = () => drawFilteredGraph(params.node);
    docSelect.addEventListener("change", redraw);
    $$("#type-filters input, #confidence-filters input").forEach((input) => input.addEventListener("change", redraw));
    $("#graph-search").addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        const results = await api.searchEntities(event.target.value);
        const first = results.items[0];
        if (first) {
          activeGraph?.focusNode(first.node_id);
          showNodeDetail(first.node_id);
        } else {
          toast("No entity found", "warning");
        }
      }
    });
    $("#zoom-in").addEventListener("click", () => activeGraph?.zoomIn());
    $("#zoom-out").addEventListener("click", () => activeGraph?.zoomOut());
    $("#fit-graph").addEventListener("click", () => activeGraph?.fit());
    $("#export-png").addEventListener("click", () => exportGraphAsPng(activeGraph));
    $("#export-json").addEventListener("click", async () => downloadJson("knowledge-graph.json", await api.exportKg()));
    drawFilteredGraph(params.node);
  } catch (error) {
    $("#kg-canvas").innerHTML = emptyState("KG 为空", "可以先加载 Demo 或上传并索引文档。", '<button class="btn btn-primary" id="empty-demo">加载示例</button>');
    $("#empty-demo")?.addEventListener("click", async () => {
      await api.loadDemo();
      AppState.kg.loaded = false;
      renderGraphPage();
    });
  }
}

function drawFilteredGraph(focusNodeId = "") {
  const docId = $("#graph-doc-filter")?.value || "";
  const types = new Set($$("#type-filters input:checked").map((input) => input.value));
  const confidences = new Set($$("#confidence-filters input:checked").map((input) => input.value));
  const nodes = AppState.kg.nodes.filter((node) => (!docId || node.doc_id === docId || node.is_hub) && types.has(node.type) && confidences.has(node.confidence));
  const nodeIds = new Set(nodes.map((node) => node.node_id));
  const edges = AppState.kg.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  activeGraph?.destroy?.();
  activeGraph = renderGraph("#kg-canvas", nodes, edges, {
    onNodeClick: (node) => showNodeDetail(node.node_id),
    onBlankClick: () => ($("#detail-panel").innerHTML = `<div class="panel-section">${emptyState("选择节点", "点击图谱节点查看详情、邻居和智能问答。")}</div>`),
  });
  if ($("#graph-runtime") && activeGraph) {
    $("#graph-runtime").textContent = `${nodes.length} nodes · ${edges.length} edges · ${activeGraph.renderer.toUpperCase()}`;
  }
  renderLegend("#graph-legend");
  if (focusNodeId) {
    setTimeout(() => {
      activeGraph?.focusNode(focusNodeId);
      showNodeDetail(focusNodeId);
    }, 700);
  }
}

async function showNodeDetail(nodeId) {
  try {
    const [node, neighbors] = await Promise.all([api.getNode(nodeId), api.getNeighbors(nodeId, 1)]);
    $("#detail-panel").innerHTML = `
      <div class="panel-section"><h1>${escapeHtml(node.name)}</h1>${typeBadge(node.type)} <span class="badge">${escapeHtml(node.confidence)}</span></div>
      <div class="panel-section"><h3>Attributes</h3><p class="small">Page ${node.page} · degree ${node.degree} · doc ${escapeHtml(node.doc_id)}</p><p>${escapeHtml(node.description || "")}</p></div>
      <div class="panel-section"><h3>Neighbors</h3><div class="tag-row">${neighbors.nodes.filter((item) => item.node_id !== nodeId).map((item) => `<button class="badge type-${item.type}" data-neighbor="${item.node_id}">${escapeHtml(item.name)}</button>`).join("") || '<span class="small">No neighbors</span>'}</div></div>
      <div class="panel-section"><a class="btn btn-primary" href="#/chat?q=${encodeURIComponent(`Tell me about ${node.name}`)}">智能问答</a></div>
    `;
    $$("[data-neighbor]").forEach((button) => button.addEventListener("click", () => {
      activeGraph?.focusNode(button.dataset.neighbor);
      showNodeDetail(button.dataset.neighbor);
    }));
  } catch (error) {
    showError(error, "节点详情加载失败");
  }
}

async function renderChat(params = {}) {
  main().className = "main";
  AppState.conversation = [];
  main().innerHTML = pageHead("智能问答", "混合问答：知识图谱走 ReAct，实时问题联网检索，其他问题由通用大模型回答。") + `
    <section class="chat-layout">
      <aside class="card chat-history"><h2>历史记录</h2><div id="history-list"></div></aside>
      <section class="chat-area">
        <div class="messages" id="messages"></div>
        <div class="tag-row" id="suggested-prompts"></div>
        <div class="chat-input-row"><textarea class="textarea" id="chat-input" placeholder="询问当前知识图谱；批量模式下每行一个问题..."></textarea><button class="btn btn-secondary" id="batch-chat">批量</button><button class="btn btn-primary" id="send-chat">发送</button></div>
      </section>
    </section>
  `;
  $("#chat-input").value = params.q || "";
  $("#suggested-prompts").innerHTML = ["高血压有哪些常见症状和治疗方法？", "出现持续咳嗽和发热应该考虑哪些疾病？", "糖尿病常用哪些药物，应前往什么科室？", "哪些疾病通常建议到呼吸内科就诊？", "今天踢世界杯的球队名称"]
    .map((prompt) => `<button class="badge" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`)
    .join("");
  $$("[data-prompt]").forEach((button) => button.addEventListener("click", () => ($("#chat-input").value = button.dataset.prompt)));
  $("#send-chat").addEventListener("click", sendChat);
  $("#batch-chat").addEventListener("click", sendBatchChat);
  $("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });
  await refreshHistory();
  if (params.q) $("#chat-input").focus();
}

async function refreshHistory() {
  try {
    const history = await api.getQueryHistory({ page_size: 20 });
    AppState.chatHistory = history.items;
    $("#history-list").innerHTML = history.items.length
      ? history.items.map((item) => `<div class="history-item" data-history="${item.query_id}"><strong>${escapeHtml(item.question)}</strong><div class="small">${escapeHtml(item.created_at)}</div></div>`).join("")
      : '<p class="small">暂无历史记录。</p>';
    $$("[data-history]").forEach((item) => item.addEventListener("click", () => {
      const record = AppState.chatHistory.find((entry) => entry.query_id === item.dataset.history);
      if (record) {
        AppState.conversation = [
          { role: "user", content: String(record.question || "") },
          { role: "assistant", content: String(record.answer || "") },
        ];
        $("#messages").innerHTML = "";
        appendMessage("user", record.question || "");
        renderAnswer(record);
      }
    }));
  } catch (error) {
    showError(error, "历史加载失败");
  }
}

function appendMessage(role, content) {
  const messages = $("#messages");
  const node = document.createElement("article");
  node.className = `message ${role}`;
  if (role === "ai" && String(content).includes('class="thinking"')) {
    node.innerHTML = content;
  } else {
    node.innerHTML = role === "ai" ? renderMarkdown(content) : escapeHtml(content);
  }
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
  return node;
}

async function sendChat() {
  const input = $("#chat-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  appendMessage("user", question);
  const thinking = appendMessage("ai", '<span class="thinking"><span></span><span></span><span></span></span>');
  try {
    const history = AppState.conversation.slice(-10);
    const result = await api.query(question, history);
    thinking.remove();
    renderAnswer(result);
    AppState.conversation.push(
      { role: "user", content: question },
      { role: "assistant", content: String(result.answer || "") },
    );
    await refreshHistory();
    await refreshShellStats();
  } catch (error) {
    thinking.remove();
    showError(error, "问答失败");
  }
}

async function sendBatchChat() {
  const input = $("#chat-input");
  const questions = input.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (questions.length < 2) {
    toast("批量问答请每行输入一个问题，至少两行", "warning");
    return;
  }
  const button = $("#batch-chat");
  button.disabled = true;
  try {
    const created = await api.queryBatch(questions);
    const batch = await api.getBatch(created.batch_id);
    $("#messages").innerHTML = "";
    batch.results.forEach((result) => {
      appendMessage("user", result.question);
      renderAnswer(result);
    });
    input.value = "";
    toast(`批量问答完成：${batch.results.length} 条`, "success");
  } catch (error) {
    showError(error, "批量问答失败");
  } finally {
    button.disabled = false;
  }
}

function renderAnswer(result, clear = false) {
  if (clear) $("#messages").innerHTML = "";
  const node = appendMessage("ai", result.answer || "");
  const tools = result.tool_calls || [];
  const cited = result.cited_nodes || [];
  const sources = result.sources || [];
  const modeLabels = {
    knowledge_graph: "知识图谱",
    web_search: "联网检索",
    general_llm: "通用大模型",
  };
  node.innerHTML += `
    <div class="tag-row answer-meta"><span class="badge">模式：${escapeHtml(modeLabels[result.answer_mode] || result.answer_mode || "历史记录")}</span></div>
    <details class="tool-call"><summary>Tool Calls (${tools.length} steps)</summary><pre>${escapeHtml(JSON.stringify(tools, null, 2))}</pre></details>
    <div class="tag-row">${cited.map((item) => `<a class="badge type-${item.type}" href="#/graph?node=${encodeURIComponent(item.node_id)}">◉ ${escapeHtml(item.name)}</a>`).join("")}</div>
    ${sources.length ? `<div class="answer-sources"><strong>信息来源</strong><ol>${sources.map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a><div class="small">${escapeHtml(item.snippet || "")}</div></li>`).join("")}</ol></div>` : ""}
    <p class="small">⏱ ${result.duration || 0}s</p>
    ${result.agent ? `<p class="small">Agent: ${escapeHtml(result.agent)} · history ${Number(result.history_turns || 0)} turns</p>` : ""}
  `;
}

async function renderSearch(params = {}) {
  main().className = "main";
  const activeTab = params.tab || "entity";
  main().innerHTML = pageHead("知识搜索", "实体搜索、路径搜索和子图搜索三种探索模式。") + `
    <section class="card glow">
      <div class="toolbar" id="search-tabs">
        <button class="btn ${activeTab === "entity" ? "btn-primary" : "btn-secondary"}" data-tab="entity">实体搜索</button>
        <button class="btn ${activeTab === "path" ? "btn-primary" : "btn-secondary"}" data-tab="path">路径搜索</button>
        <button class="btn ${activeTab === "graph" ? "btn-primary" : "btn-secondary"}" data-tab="graph">子图搜索</button>
      </div>
      <div id="search-body"></div>
    </section>
  `;
  $$("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    location.hash = `#/search?tab=${button.dataset.tab}`;
  }));
  if (activeTab === "path") await renderPathSearch();
  else if (activeTab === "graph") await renderGraphSearch(params.q || "");
  else await renderEntitySearch(params.q || "", params.type || "");
}

async function renderEntitySearch(q = "", type = "") {
  $("#search-body").innerHTML = `
    <div class="toolbar"><input class="input" id="entity-q" value="${escapeHtml(q)}" placeholder="输入实体名称..." /><select class="select" id="entity-type" style="max-width:180px"><option value="All">全部类型</option>${Object.keys(TypeColors).map((item) => `<option ${type === item ? "selected" : ""}>${item}</option>`).join("")}</select><button class="btn btn-primary" id="entity-search-btn">搜索</button></div>
    <section class="two-column"><div id="entity-results"></div><div class="preview-graph" id="entity-preview"></div></section>
  `;
  const run = async () => {
    try {
      const results = await api.searchEntities($("#entity-q").value, $("#entity-type").value);
      $("#entity-results").innerHTML = results.items.length ? results.items.map((item) => `<div class="card" style="margin-bottom:10px" data-result="${item.node_id}"><h2>${escapeHtml(item.name)}</h2>${typeBadge(item.type)} <span class="badge">得分 ${item.score}</span><p class="small">${escapeHtml(item.description || "")}</p><div class="toolbar"><a class="btn btn-sm btn-secondary" href="#/graph?node=${item.node_id}">查看图谱</a><a class="btn btn-sm btn-secondary" href="#/chat?q=${encodeURIComponent(`What is ${item.name}?`)}">智能问答</a></div></div>`).join("") : emptyState("没有结果", "请尝试其他关键词，或打开知识图谱浏览。");
      $$("[data-result]").forEach((card) => card.addEventListener("click", async () => {
        const data = await api.getNeighbors(card.dataset.result, 1);
        previewGraph?.destroy?.();
        previewGraph = renderGraph("#entity-preview", data.nodes, data.edges);
      }));
      if (results.items[0]) {
        const data = await api.getNeighbors(results.items[0].node_id, 1);
        previewGraph?.destroy?.();
        previewGraph = renderGraph("#entity-preview", data.nodes, data.edges);
      }
    } catch (error) {
      showError(error, "实体搜索失败");
    }
  };
  $("#entity-search-btn").addEventListener("click", run);
  $("#entity-q").addEventListener("keydown", (event) => event.key === "Enter" && run());
  if (q) run();
}

async function renderPathSearch() {
  await loadKg();
  const options = AppState.kg.nodes.map((node) => `<option value="${node.node_id}">${escapeHtml(node.name)}</option>`).join("");
  $("#search-body").innerHTML = `
    <div class="toolbar"><select class="select" id="path-from">${options}</select><select class="select" id="path-to">${options}</select><select class="select" id="max-hops" style="max-width:120px">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select><button class="btn btn-primary" id="find-path">查找路径</button></div>
    <div id="path-result"></div>
  `;
  $("#find-path").addEventListener("click", async () => {
    try {
      const result = await api.searchPath($("#path-from").value, $("#path-to").value, $("#max-hops").value);
      renderPathChain($("#path-result"), result.nodes);
    } catch (error) {
      showError(error, "路径搜索失败");
    }
  });
}

async function renderGraphSearch(q = "") {
  $("#search-body").innerHTML = `
    <div class="toolbar"><input class="input" id="graph-q" value="${escapeHtml(q)}" placeholder="输入关键词..." /><label class="badge"><input type="checkbox" id="include-neighbors" checked /> 包含邻居</label><button class="btn btn-primary" id="graph-search-btn">搜索</button></div>
    <div class="preview-graph" style="height:460px" id="graph-search-preview"></div><div id="graph-match-list" style="margin-top:12px"></div>
  `;
  const run = async () => {
    try {
      const result = await api.searchGraph($("#graph-q").value, $("#include-neighbors").checked);
      previewGraph?.destroy?.();
      if (!result.matches.length || !result.nodes.length) {
        previewGraph = null;
        $("#graph-search-preview").innerHTML = emptyState("未找到匹配子图", "请检查实体名称，或先上传并索引包含该实体的文档。", '<a class="btn btn-primary" href="#/documents">上传并索引 →</a>');
        $("#graph-match-list").innerHTML = '<span class="small">没有匹配实体</span>';
        return;
      }
      previewGraph = renderGraph("#graph-search-preview", result.nodes, result.edges);
      $("#graph-match-list").innerHTML = result.matches
        .map((item) => `<button class="badge type-${item.type} graph-match" data-focus-match="${item.node_id}" aria-pressed="false">◎ ${escapeHtml(item.name)}</button>`)
        .join(" ");
      const focusMatch = (nodeId) => {
        previewGraph?.focusNode(nodeId);
        $$('[data-focus-match]').forEach((button) => {
          const selected = button.dataset.focusMatch === nodeId;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
      };
      $$('[data-focus-match]').forEach((button) => button.addEventListener("click", () => focusMatch(button.dataset.focusMatch)));
      setTimeout(() => focusMatch(result.matches[0].node_id), 750);
    } catch (error) {
      showError(error, "子图搜索失败");
    }
  };
  $("#graph-search-btn").addEventListener("click", run);
  $("#graph-q").addEventListener("keydown", (event) => event.key === "Enter" && run());
  if (q) run();
}

async function renderSystem() {
  main().className = "main";
  main().innerHTML = pageHead("系统状态", "健康检查、格式支持、API 覆盖和运行信息。") + `
    <section class="grid grid-2">
      <div class="card glow"><h2>健康状态</h2><div id="system-health"></div></div>
      <div class="card glow"><h2>支持格式</h2><div id="formats"></div></div>
    </section>
    <section class="card glow" style="margin-top:16px"><h2>API 覆盖</h2><div id="api-coverage"></div></section>
  `;
  try {
    const [health, formats] = await Promise.all([api.health(), api.formats()]);
    $("#system-health").innerHTML = Object.entries(health.services).map(([name, service]) => `<p>${escapeHtml(name)} ${service.ok ? statusBadge("indexed") : statusBadge("failed")} <span class="small">${escapeHtml(service.detail)}</span></p>`).join("");
    $("#formats").innerHTML = `<div class="tag-row">${formats.formats.map((item) => `<span class="badge">${escapeHtml(item.ext)}</span>`).join("")}</div><p class="small">Max ${formats.max_size_mb}MB per file</p>`;
    const endpoints = ["documents/upload", "documents/{id}", "documents", "index/start", "index/status/{id}", "index/result/{id}", "index/jobs/{id}", "kg/nodes", "kg/edges", "kg/nodes/{id}", "kg/nodes/{id}/neighbors", "kg/stats", "kg/export", "query", "query/batch", "query/batch/{id}", "query/history", "search/entities", "search/path", "search/graph", "health", "system/stats", "system/formats", "system/demo"];
    $("#api-coverage").innerHTML = `<div class="tag-row">${endpoints.map((item) => `<span class="badge indexed">✓ ${escapeHtml(item)}</span>`).join("")}</div>`;
  } catch (error) {
    showError(error, "系统信息加载失败");
  }
}
