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

async function loadDocuments(pageSize = 50, kbId = "") {
  const payload = await api.listDocuments({ page_size: pageSize, kb_id: kbId });
  AppState.documents = payload.items;
  return payload;
}

async function loadAgentCatalog() {
  const [knowledgeBases, agents, stats] = await Promise.all([api.listKnowledgeBases(), api.listAgents(), api.getAgentStats()]);
  AppState.knowledgeBases = knowledgeBases.items;
  const statsByAgent = Object.fromEntries(stats.items.map((item) => [item.agent_id, item]));
  AppState.agents = agents.items.map((item) => ({ ...item, usage: statsByAgent[item.agent_id] || item.usage }));
  AppState.agentTools = agents.available_tools || [];
  return { knowledgeBases: AppState.knowledgeBases, agents: AppState.agents };
}

function knowledgeBaseName(kbId) {
  return AppState.knowledgeBases.find((item) => item.kb_id === kbId)?.name || kbId || "未分类";
}

async function loadKg(force = false, kbId = "") {
  if (AppState.kg.loaded && AppState.kg.scope === kbId && !force) return AppState.kg;
  const [nodesPayload, edgesPayload] = await Promise.allSettled([
    api.listNodes({ page_size: 5000, kb_id: kbId }),
    api.listEdges({ page_size: 20000, kb_id: kbId }),
  ]);
  AppState.kg.nodes = nodesPayload.status === "fulfilled" ? nodesPayload.value.items : [];
  AppState.kg.edges = edgesPayload.status === "fulfilled" ? edgesPayload.value.items : [];
  AppState.kg.loaded = true;
  AppState.kg.scope = kbId;
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
              <td><strong>${escapeHtml(doc.filename)}</strong><div class="small">${formatBytes(doc.size)} · ${escapeHtml(knowledgeBaseName(doc.kb_id))}</div>${doc.error ? `<div class="small" style="color:var(--red)">${escapeHtml(doc.error)}</div>` : ""}</td>
              <td>${escapeHtml((doc.format || "").toUpperCase())}</td>
              <td>${doc.pages || "—"}</td>
              <td>${statusBadge(doc.status)}<div style="margin-top:6px">${progressBar(doc.progress || 0)}</div><div class="small">${escapeHtml(doc.stage || "")}</div>${resultSummary(doc.result)}</td>
              <td>${escapeHtml((doc.uploaded_at || "").slice(0, 19).replace("T", " "))}</td>
              ${compact ? "" : `<td><div class="toolbar">
                ${doc.status === "uploaded" || doc.status === "failed" ? `<button class="btn btn-sm btn-primary" data-action="index" data-doc="${doc.doc_id}">▶ 开始索引</button>` : ""}
                ${doc.status === "indexing" ? `<button class="btn btn-sm btn-secondary" data-action="cancel-doc" data-doc="${doc.doc_id}" data-job="${doc.job_id || ""}">✕ 取消任务</button>` : ""}
                ${doc.status === "indexed" ? `<a class="btn btn-sm btn-secondary" href="#/graph?kb_id=${encodeURIComponent(doc.kb_id || "")}&doc_id=${encodeURIComponent(doc.doc_id)}">◉ 查看图谱</a>` : ""}
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

async function renderKnowledgeBases() {
  main().className = "main";
  await loadAgentCatalog();
  main().innerHTML = pageHead(
    "知识库管理",
    "创建和维护知识库，并查看每个知识库完全独立的图谱视图。",
    '<button class="btn btn-primary" id="create-kb">＋ 新建知识库</button>',
  ) + `
    <section class="management-grid" id="kb-management-grid">
      ${AppState.knowledgeBases.map((kb) => `
        <article class="card management-card glow" data-kb-card="${escapeHtml(kb.kb_id)}">
          <div><span class="eyebrow">${escapeHtml(kb.domain || "general")}</span><h2>${escapeHtml(kb.name)}</h2><p>${escapeHtml(kb.description || "暂无描述")}</p></div>
          <div class="agent-stats"><span>${Number(kb.documents || 0)} 文档</span><span>${Number(kb.nodes || 0)} 节点</span><span>${Number(kb.edges || 0)} 关系</span></div>
          <div class="toolbar management-actions">
            <a class="btn btn-primary" data-kb-graph="${escapeHtml(kb.kb_id)}" href="#/graph?kb_id=${encodeURIComponent(kb.kb_id)}">◉ 独立图谱</a>
            <button class="btn btn-secondary" data-edit-kb="${escapeHtml(kb.kb_id)}">编辑</button>
            ${kb.built_in ? '<span class="badge">内置</span>' : `<button class="btn btn-danger" data-delete-kb="${escapeHtml(kb.kb_id)}">删除</button>`}
          </div>
        </article>
      `).join("")}
    </section>
  `;
  $("#create-kb").addEventListener("click", () => showKnowledgeBaseEditor());
  $$('[data-edit-kb]').forEach((button) => button.addEventListener("click", async () => {
    try {
      showKnowledgeBaseEditor(await api.getKnowledgeBase(button.dataset.editKb));
    } catch (error) {
      showError(error, "加载知识库配置失败");
    }
  }));
  $$('[data-delete-kb]').forEach((button) => button.addEventListener("click", async () => {
    const kb = AppState.knowledgeBases.find((item) => item.kb_id === button.dataset.deleteKb);
    if (!await confirmModal("删除知识库？", `${kb?.name || button.dataset.deleteKb} 只有在没有文档和绑定智能体时才能删除。`, "删除", true)) return;
    try {
      await api.deleteKnowledgeBase(button.dataset.deleteKb);
      toast("知识库已删除", "success");
      await renderKnowledgeBases();
    } catch (error) {
      showError(error, "删除知识库失败");
    }
  }));
}

function showKnowledgeBaseEditor(kb = null) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="${kb ? "编辑" : "新建"}知识库">
      <form class="modal management-form" id="kb-editor">
        <h2>${kb ? "编辑知识库" : "新建知识库"}</h2>
        ${kb ? `<p class="small">ID：${escapeHtml(kb.kb_id)}</p>` : '<label>知识库 ID（可留空自动生成）<input class="input" name="kb_id" placeholder="kb_example" /></label>'}
        <label>名称<input class="input" name="name" required maxlength="80" value="${escapeHtml(kb?.name || "")}" /></label>
        <label>领域<input class="input" name="domain" maxlength="60" value="${escapeHtml(kb?.domain || "general")}" /></label>
        <label>描述<textarea class="textarea" name="description" maxlength="500">${escapeHtml(kb?.description || "")}</textarea></label>
        <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-editor>取消</button><button class="btn btn-primary" type="submit">保存</button></div>
      </form>
    </div>`;
  root.querySelector("[data-close-editor]").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector("#kb-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (kb) await api.updateKnowledgeBase(kb.kb_id, values);
      else await api.createKnowledgeBase(values);
      root.innerHTML = "";
      toast(kb ? "知识库配置已更新" : "知识库已创建", "success");
      await renderKnowledgeBases();
    } catch (error) {
      showError(error, "保存知识库失败");
    }
  });
}

async function renderDocuments() {
  main().className = "main";
  try {
    await loadAgentCatalog();
  } catch (error) {
    AppState.knowledgeBases = [
      { kb_id: "kb_medical", name: "医疗知识库" },
      { kb_id: "kb_technical", name: "GraphRAG 技术知识库" },
    ];
  }
  main().innerHTML = pageHead("文档管理", "上传、索引、监控和管理知识文档。") + `
    <section class="card glow">
      <div class="toolbar"><label for="upload-kb"><strong>所属知识库</strong></label><select class="select" id="upload-kb" style="max-width:320px">${AppState.knowledgeBases.map((item) => `<option value="${item.kb_id}">${escapeHtml(item.name)}</option>`).join("")}</select><span class="small">上传后的实体和关系只供该知识库智能体检索</span></div>
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
      const doc = await api.uploadDocument(file, $("#upload-kb")?.value || "kb_technical");
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
  const selectedKbId = params.kb_id || "";
  try {
    await loadAgentCatalog();
  } catch (error) {
    AppState.knowledgeBases = [];
  }
  main().innerHTML = `
    <section class="graph-layout">
      <aside class="filter-panel">
        <div class="panel-section"><span class="eyebrow">KG Explorer</span><h2>筛选</h2></div>
        <div class="panel-section"><h3>知识库</h3><select class="select" id="graph-kb-filter"><option value="">全部知识库</option>${AppState.knowledgeBases.map((kb) => `<option value="${kb.kb_id}" ${kb.kb_id === selectedKbId ? "selected" : ""}>${escapeHtml(kb.name)}</option>`).join("")}</select></div>
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
    const [, , kgStats] = await Promise.all([loadDocuments(50, selectedKbId), loadKg(true, selectedKbId), api.getKgStats(selectedKbId)]);
    $("#graph-runtime").textContent = `${kgStats.nodes} nodes · ${kgStats.edges} edges`;
    const docSelect = $("#graph-doc-filter");
    docSelect.innerHTML += AppState.documents.map((doc) => `<option value="${doc.doc_id}">${escapeHtml(doc.filename)}</option>`).join("");
    if (params.doc_id) docSelect.value = params.doc_id;
    const typeCounts = AppState.kg.nodes.reduce((acc, node) => ({ ...acc, [node.type]: (acc[node.type] || 0) + 1 }), {});
    $("#type-filters").innerHTML = Object.entries(TypeColors).map(([type]) => `<label><input type="checkbox" value="${type}" checked /> ${type} <span class="small">(${typeCounts[type] || 0})</span></label>`).join("");
    $("#confidence-filters").innerHTML = ["exact", "greater", "lesser", "fuzzy"].map((value) => `<label><input type="checkbox" value="${value}" checked /> ${value}</label>`).join("");
    const redraw = () => drawFilteredGraph(params.node, selectedKbId);
    $("#graph-kb-filter").addEventListener("change", (event) => {
      location.hash = event.target.value ? `#/graph?kb_id=${encodeURIComponent(event.target.value)}` : "#/graph";
    });
    docSelect.addEventListener("change", redraw);
    $$("#type-filters input, #confidence-filters input").forEach((input) => input.addEventListener("change", redraw));
    $("#graph-search").addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        const results = await api.searchEntities(event.target.value, "", selectedKbId);
        const first = results.items[0];
        if (first) {
          activeGraph?.focusNode(first.node_id);
          showNodeDetail(first.node_id, selectedKbId);
        } else {
          toast("No entity found", "warning");
        }
      }
    });
    $("#zoom-in").addEventListener("click", () => activeGraph?.zoomIn());
    $("#zoom-out").addEventListener("click", () => activeGraph?.zoomOut());
    $("#fit-graph").addEventListener("click", () => activeGraph?.fit());
    $("#export-png").addEventListener("click", () => exportGraphAsPng(activeGraph));
    $("#export-json").addEventListener("click", async () => downloadJson(selectedKbId ? `${selectedKbId}-graph.json` : "knowledge-graph.json", await api.exportKg(selectedKbId)));
    drawFilteredGraph(params.node, selectedKbId);
  } catch (error) {
    $("#kg-canvas").innerHTML = emptyState("KG 为空", "可以先加载 Demo 或上传并索引文档。", '<button class="btn btn-primary" id="empty-demo">加载示例</button>');
    $("#empty-demo")?.addEventListener("click", async () => {
      await api.loadDemo();
      AppState.kg.loaded = false;
      renderGraphPage();
    });
  }
}

function drawFilteredGraph(focusNodeId = "", kbId = "") {
  const docId = $("#graph-doc-filter")?.value || "";
  const selectedKbId = AppState.documents.find((item) => item.doc_id === docId)?.kb_id || "";
  const types = new Set($$("#type-filters input:checked").map((input) => input.value));
  const confidences = new Set($$("#confidence-filters input:checked").map((input) => input.value));
  const nodes = AppState.kg.nodes.filter((node) => {
    const inScope = !docId || node.doc_id === docId || (node.is_hub && node.kb_id === selectedKbId) || node.kb_id === "__global__";
    return inScope && types.has(node.type) && confidences.has(node.confidence);
  });
  const nodeIds = new Set(nodes.map((node) => node.node_id));
  const edges = AppState.kg.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  activeGraph?.destroy?.();
  activeGraph = renderGraph("#kg-canvas", nodes, edges, {
    onNodeClick: (node) => showNodeDetail(node.node_id, kbId),
    onBlankClick: () => ($("#detail-panel").innerHTML = `<div class="panel-section">${emptyState("选择节点", "点击图谱节点查看详情、邻居和智能问答。")}</div>`),
  });
  if ($("#graph-runtime") && activeGraph) {
    $("#graph-runtime").textContent = `${nodes.length} nodes · ${edges.length} edges · ${activeGraph.renderer.toUpperCase()}`;
  }
  renderLegend("#graph-legend");
  if (focusNodeId) {
    setTimeout(() => {
      activeGraph?.focusNode(focusNodeId);
      showNodeDetail(focusNodeId, kbId);
    }, 700);
  }
}

async function showNodeDetail(nodeId, kbId = "") {
  try {
    const [node, neighbors] = await Promise.all([api.getNode(nodeId, kbId), api.getNeighbors(nodeId, 1, kbId)]);
    $("#detail-panel").innerHTML = `
      <div class="panel-section"><h1>${escapeHtml(node.name)}</h1>${typeBadge(node.type)} <span class="badge">${escapeHtml(node.confidence)}</span></div>
      <div class="panel-section"><h3>Attributes</h3><p class="small">Page ${node.page} · degree ${node.degree} · doc ${escapeHtml(node.doc_id)}</p><p>${escapeHtml(node.description || "")}</p></div>
      <div class="panel-section"><h3>Neighbors</h3><div class="tag-row">${neighbors.nodes.filter((item) => item.node_id !== nodeId).map((item) => `<button class="badge type-${item.type}" data-neighbor="${item.node_id}">${escapeHtml(item.name)}</button>`).join("") || '<span class="small">No neighbors</span>'}</div></div>
      <div class="panel-section"><a class="btn btn-primary" href="#/chat?q=${encodeURIComponent(`Tell me about ${node.name}`)}">智能问答</a></div>
    `;
    $$("[data-neighbor]").forEach((button) => button.addEventListener("click", () => {
      activeGraph?.focusNode(button.dataset.neighbor);
      showNodeDetail(button.dataset.neighbor, kbId);
    }));
  } catch (error) {
    showError(error, "节点详情加载失败");
  }
}

async function renderChat(params = {}) {
  main().className = "main";
  try {
    await loadAgentCatalog();
  } catch (error) {
    AppState.agents = [];
  }
  main().innerHTML = pageHead("智能问答", "Supervisor 自动判断单智能体、跨知识库协同、联网或通用问答，并保留对话级智能体记忆。", '<button class="btn btn-secondary" id="new-conversation">＋ 新对话</button><a class="btn btn-secondary" href="#/agents">✦ 智能体管理</a>') + `
    <section class="chat-layout">
      <aside class="card chat-history"><div class="toolbar"><h2 style="margin-right:auto">历史记录</h2><button class="btn btn-sm btn-ghost" id="clear-agent-memory">清除记忆</button></div><p class="small" id="agent-memory-summary">正在读取对话记忆…</p><div id="history-list"></div></aside>
      <section class="chat-area">
        <div class="toolbar agent-selector"><label for="chat-agent"><strong>智能体</strong></label><select class="select" id="chat-agent" style="max-width:300px"><option value="auto">自动选择（Supervisor）</option>${AppState.agents.map((item) => `<option value="${item.agent_id}">${escapeHtml(item.name)}${item.kb_name ? ` · ${escapeHtml(item.kb_name)}` : ""}</option>`).join("")}</select><span class="small" id="agent-description">根据问题自动选择单智能体或跨知识库协同</span><span class="badge memory-session" id="memory-session">记忆 ${escapeHtml(AppState.conversationId.slice(-8))}</span></div>
        <div class="messages" id="messages"></div>
        <div class="tag-row" id="suggested-prompts"></div>
        <div class="chat-input-row"><textarea class="textarea" id="chat-input" placeholder="询问当前知识图谱；批量模式下每行一个问题..."></textarea><button class="btn btn-secondary" id="batch-chat">批量</button><button class="btn btn-primary" id="send-chat">发送</button></div>
      </section>
    </section>
  `;
  $("#chat-input").value = params.q || "";
  $("#chat-agent").addEventListener("change", (event) => {
    const selected = AppState.agents.find((item) => item.agent_id === event.target.value);
    $("#agent-description").textContent = selected?.description || "根据问题自动选择知识库、联网或通用智能体";
  });
  if (params.agent && AppState.agents.some((item) => item.agent_id === params.agent)) {
    $("#chat-agent").value = params.agent;
    $("#chat-agent").dispatchEvent(new Event("change"));
  }
  $("#suggested-prompts").innerHTML = ["高血压有哪些常见症状和治疗方法？", "比较高血压知识与 GraphRAG 的核心技术", "糖尿病常用哪些药物，应前往什么科室？", "哪些疾病通常建议到呼吸内科就诊？", "今天踢世界杯的球队名称"]
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
  $("#new-conversation").addEventListener("click", () => {
    AppState.conversationId = createConversationId();
    AppState.conversation = [];
    $("#messages").innerHTML = "";
    $("#memory-session").textContent = `记忆 ${AppState.conversationId.slice(-8)}`;
    toast("已创建新对话，智能体记忆从空白开始", "success");
    refreshMemoryStatus();
  });
  $("#clear-agent-memory").addEventListener("click", async () => {
    if (!await confirmModal("清除当前对话记忆？", "这会删除各智能体为当前对话保存的历史，但不会删除问答记录。", "清除", true)) return;
    try {
      await api.clearConversationMemory(AppState.conversationId);
      AppState.conversation = [];
      await refreshMemoryStatus();
      toast("当前对话的智能体记忆已清除", "success");
    } catch (error) {
      showError(error, "清除对话记忆失败");
    }
  });
  await refreshHistory();
  await refreshMemoryStatus();
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
        AppState.conversationId = record.conversation_id || createConversationId();
        $("#memory-session").textContent = `记忆 ${AppState.conversationId.slice(-8)}`;
        refreshMemoryStatus();
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

async function refreshMemoryStatus() {
  const root = $("#agent-memory-summary");
  if (!root) return;
  try {
    const memory = await api.getConversationMemory(AppState.conversationId);
    const turns = memory.items.reduce((total, item) => total + Number(item.turns?.length || 0), 0);
    root.textContent = memory.total ? `${memory.total} 个智能体记忆 · ${turns} 条消息` : "当前对话尚无智能体记忆";
  } catch (error) {
    root.textContent = "对话记忆暂不可用";
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
    const result = await api.query(question, history, $("#chat-agent")?.value || "auto", null, AppState.conversationId);
    thinking.remove();
    renderAnswer(result);
    AppState.conversation.push(
      { role: "user", content: question },
      { role: "assistant", content: String(result.answer || "") },
    );
    await refreshHistory();
    await refreshMemoryStatus();
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
    const created = await api.queryBatch(questions, $("#chat-agent")?.value || "auto");
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
  const collaborators = result.collaborating_agents || [];
  const modeLabels = {
    knowledge_graph: "知识图谱",
    web_search: "联网检索",
    general_llm: "通用大模型",
    multi_agent: "多智能体协同",
  };
  node.innerHTML += `
    <div class="tag-row answer-meta">
      <span class="badge">模式：${escapeHtml(modeLabels[result.answer_mode] || result.answer_mode || "历史记录")}</span>
      ${result.agent_name ? `<span class="badge">智能体：${escapeHtml(result.agent_name)}</span>` : ""}
      ${result.kb_name ? `<span class="badge">知识库：${escapeHtml(result.kb_name)}</span>` : ""}
      ${result.memory_used ? `<span class="badge memory-active">已调用对话记忆 · ${Number(result.memory_turns || 0)} 条</span>` : ""}
    </div>
    ${result.route_reason ? `<p class="small route-reason">路由原因：${escapeHtml(result.route_reason)}</p>` : ""}
    ${collaborators.length ? `<div class="collaboration-trace"><strong>协同智能体</strong><div class="tag-row">${collaborators.map((item) => `<span class="badge">${escapeHtml(item.agent_name)} · ${escapeHtml(item.kb_name)} · ${Number(item.duration || 0)}s</span>`).join("")}</div></div>` : ""}
    <details class="tool-call"><summary>Tool Calls (${tools.length} steps)</summary><pre>${escapeHtml(JSON.stringify(tools, null, 2))}</pre></details>
    <div class="tag-row">${cited.map((item) => `<a class="badge type-${item.type}" href="#/graph?${item.kb_id && item.kb_id !== "__global__" ? `kb_id=${encodeURIComponent(item.kb_id)}&` : ""}node=${encodeURIComponent(item.node_id)}">◉ ${escapeHtml(item.name)}</a>`).join("")}</div>
    ${sources.length ? `<div class="answer-sources"><strong>信息来源</strong><ol>${sources.map((item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a><div class="small">${escapeHtml(item.snippet || "")}</div></li>`).join("")}</ol></div>` : ""}
    <p class="small">⏱ ${result.duration || 0}s</p>
    ${result.agent ? `<p class="small">Agent: ${escapeHtml(result.agent)} · history ${Number(result.history_turns || 0)} turns</p>` : ""}
    ${result.query_id ? `<div class="answer-feedback" data-feedback-root="${escapeHtml(result.query_id)}"><span class="small">这条回答准确吗？</span><button class="btn btn-sm btn-secondary ${result.feedback_accurate === true ? "selected" : ""}" data-query-feedback="true">有帮助</button><button class="btn btn-sm btn-secondary ${result.feedback_accurate === false ? "selected" : ""}" data-query-feedback="false">不准确</button><span class="small feedback-status"></span></div>` : ""}
  `;
  node.querySelectorAll("[data-query-feedback]").forEach((button) => button.addEventListener("click", async () => {
    const root = button.closest("[data-feedback-root]");
    const accurate = button.dataset.queryFeedback === "true";
    try {
      await api.submitQueryFeedback(root.dataset.feedbackRoot, accurate);
      root.querySelectorAll("[data-query-feedback]").forEach((item) => item.classList.toggle("selected", item === button));
      root.querySelector(".feedback-status").textContent = "反馈已记录";
    } catch (error) {
      showError(error, "提交反馈失败");
    }
  }));
}

async function renderAgents() {
  main().className = "main";
  try {
    await loadAgentCatalog();
  } catch (error) {
    main().innerHTML = pageHead("智能体管理", "查看并配置知识库智能体。") + emptyState("智能体加载失败", "请检查后端 API 状态后重试。");
    return;
  }
  const modeLabels = { knowledge_graph: "知识图谱 ReAct", web_search: "实时联网检索", general_llm: "通用大模型" };
  const icons = { agent_medical: "⚕", agent_technical: "◇", agent_web: "◎", agent_general: "✦" };
  main().innerHTML = pageHead("智能体管理", "配置智能体并查看调用次数、用户反馈准确率和平均延迟。", '<button class="btn btn-primary" id="create-agent">＋ 新建智能体</button><a class="btn btn-secondary" href="#/chat?agent=auto">Supervisor 自动选择</a>') + `
    <section class="card supervisor-card glow">
      <div><span class="eyebrow">SUPERVISOR</span><h2>自动路由与多智能体协同</h2><p class="small">命中多个知识库时委派多个专业智能体并综合结果；否则选择单个知识库、联网或通用智能体。</p></div>
      <a class="btn btn-primary" href="#/chat?agent=auto">使用自动路由</a>
    </section>
    <section class="card glow route-test-panel">
      <div><span class="eyebrow">ROUTING TEST</span><h2>路由测试</h2></div>
      <div class="route-test-form"><input class="input" id="route-test-question" value="高血压有哪些症状？" placeholder="输入测试问题" /><select class="select" id="route-test-kb"><option value="">不限定知识库</option>${AppState.knowledgeBases.map((kb) => `<option value="${kb.kb_id}">${escapeHtml(kb.name)}</option>`).join("")}</select><button class="btn btn-secondary" id="run-route-test">测试路由</button></div>
      <div id="route-test-result" class="small">仅执行路由判断，不调用大模型或联网接口。</div>
    </section>
    <section class="agent-grid">
      ${AppState.agents.map((agent) => `
        <article class="card agent-card glow" data-agent-card="${agent.agent_id}">
          <div class="agent-card-head"><span class="agent-icon">${icons[agent.agent_id] || "✦"}</span><div><span class="eyebrow">${escapeHtml(agent.agent_id)}</span><h2>${escapeHtml(agent.name)}</h2></div></div>
          <p>${escapeHtml(agent.description || "")}</p>
          <div class="tag-row"><span class="badge">${escapeHtml(modeLabels[agent.mode] || agent.mode)}</span><span class="badge">${agent.allow_web_search ? "允许联网" : "禁止联网"}</span></div>
          <div class="agent-scope"><strong>绑定知识库</strong><p>${escapeHtml(agent.kb_name || "不绑定知识库")}</p></div>
          <div class="agent-tools"><strong>可用工具</strong><div class="tag-row">${(agent.tools || []).map((tool) => `<span class="badge">${escapeHtml(tool)}</span>`).join("")}</div></div>
          <div class="prompt-preview"><strong>系统提示词</strong><p class="small">${escapeHtml(agent.system_prompt || "未配置")}</p></div>
          <div class="agent-stats"><span>${Number(agent.documents || 0)} 文档</span><span>${Number(agent.nodes || 0)} 节点</span><span>${Number(agent.edges || 0)} 关系</span></div>
          <div class="usage-stats" data-agent-usage="${agent.agent_id}"><div><strong>${Number(agent.usage?.call_count || 0)}</strong><span>调用次数</span></div><div><strong>${agent.usage?.accuracy == null ? "—" : `${Number(agent.usage.accuracy)}%`}</strong><span>${agent.usage?.accuracy == null ? "暂无评价" : `准确率 · ${Number(agent.usage.rated_count || 0)} 评`}</span></div><div><strong>${Number(agent.usage?.average_latency || 0)}s</strong><span>平均延迟</span></div></div>
          <div class="toolbar management-actions"><a class="btn btn-primary" data-use-agent="${agent.agent_id}" href="#/chat?agent=${encodeURIComponent(agent.agent_id)}">选择该智能体</a><button class="btn btn-secondary" data-edit-agent="${agent.agent_id}">配置</button>${agent.built_in ? '<span class="badge">内置</span>' : `<button class="btn btn-danger" data-delete-agent="${agent.agent_id}">删除</button>`}</div>
        </article>
      `).join("")}
    </section>
  `;
  $("#create-agent").addEventListener("click", () => showAgentEditor());
  $$('[data-edit-agent]').forEach((button) => button.addEventListener("click", async () => {
    try {
      showAgentEditor(await api.getAgent(button.dataset.editAgent));
    } catch (error) {
      showError(error, "加载智能体配置失败");
    }
  }));
  $$('[data-delete-agent]').forEach((button) => button.addEventListener("click", async () => {
    const agent = AppState.agents.find((item) => item.agent_id === button.dataset.deleteAgent);
    if (!await confirmModal("删除智能体？", `确定删除 ${agent?.name || button.dataset.deleteAgent}？`, "删除", true)) return;
    try {
      await api.deleteAgent(button.dataset.deleteAgent);
      toast("智能体已删除", "success");
      await renderAgents();
    } catch (error) {
      showError(error, "删除智能体失败");
    }
  }));
  $("#run-route-test").addEventListener("click", async () => {
    const resultRoot = $("#route-test-result");
    resultRoot.textContent = "正在判断路由…";
    try {
      const result = await api.testRoute($("#route-test-question").value, "auto", $("#route-test-kb").value || null);
      resultRoot.innerHTML = `<span class="badge">${escapeHtml(result.agent_name)}</span> ${result.kb_name ? `<span class="badge">${escapeHtml(result.kb_name)}</span>` : ""}<span class="badge">${escapeHtml(modeLabels[result.mode] || (result.mode === "multi_agent" ? "多智能体协同" : result.mode))}</span>${result.collaborators?.length > 1 ? `<div class="tag-row">${result.collaborators.map((item) => `<span class="badge">${escapeHtml(item.agent_name)} → ${escapeHtml(item.kb_name)}</span>`).join("")}</div>` : ""}<p class="small">${escapeHtml(result.route_reason)}</p>`;
    } catch (error) {
      showError(error, "路由测试失败");
      resultRoot.textContent = error.message;
    }
  });
}

function showAgentEditor(agent = null) {
  const root = $("#modal-root");
  const initialMode = agent?.mode || "knowledge_graph";
  root.innerHTML = `
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="${agent ? "配置" : "新建"}智能体">
      <form class="modal management-form agent-editor-modal" id="agent-editor">
        <h2>${agent ? "配置智能体" : "新建智能体"}</h2>
        ${agent ? `<p class="small">ID：${escapeHtml(agent.agent_id)}</p>` : '<label>智能体 ID（可留空自动生成）<input class="input" name="agent_id" placeholder="agent_example" /></label>'}
        <div class="form-grid"><label>名称<input class="input" name="name" required maxlength="80" value="${escapeHtml(agent?.name || "")}" /></label><label>运行模式<select class="select" name="mode" id="agent-mode"><option value="knowledge_graph" ${initialMode === "knowledge_graph" ? "selected" : ""}>知识图谱 ReAct</option><option value="web_search" ${initialMode === "web_search" ? "selected" : ""}>实时联网检索</option><option value="general_llm" ${initialMode === "general_llm" ? "selected" : ""}>通用大模型</option></select></label></div>
        <label>绑定知识库<select class="select" name="kb_id" id="agent-kb"><option value="">不绑定知识库</option>${AppState.knowledgeBases.map((kb) => `<option value="${kb.kb_id}" ${agent?.kb_id === kb.kb_id ? "selected" : ""}>${escapeHtml(kb.name)}</option>`).join("")}</select></label>
        <label>描述<textarea class="textarea" name="description" maxlength="500">${escapeHtml(agent?.description || "")}</textarea></label>
        <label>系统提示词<textarea class="textarea prompt-editor" name="system_prompt" maxlength="6000" placeholder="定义智能体身份、回答边界和输出要求">${escapeHtml(agent?.system_prompt || "")}</textarea></label>
        <fieldset class="tool-fieldset"><legend>工具权限</legend><div class="tool-choice-grid">${AppState.agentTools.map((tool) => {
          const checked = agent ? (agent.tools || []).includes(tool.tool_id) : (tool.modes || []).includes(initialMode);
          return `<label class="tool-choice" data-tool-modes="${escapeHtml((tool.modes || []).join(","))}"><input type="checkbox" name="tools" value="${escapeHtml(tool.tool_id)}" ${checked ? "checked" : ""} /><span><strong>${escapeHtml(tool.name)}</strong><span class="small">${escapeHtml(tool.description)}</span></span></label>`;
        }).join("")}</div></fieldset>
        <label class="permission-toggle"><input type="checkbox" name="allow_web_search" ${agent?.allow_web_search ? "checked" : ""} /> 允许访问互联网</label>
        <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-editor>取消</button><button class="btn btn-primary" type="submit">保存配置</button></div>
      </form>
    </div>`;
  const modeSelect = root.querySelector("#agent-mode");
  const syncTools = (reset = false) => {
    root.querySelectorAll("[data-tool-modes]").forEach((choice) => {
      const allowed = choice.dataset.toolModes.split(",").includes(modeSelect.value);
      const checkbox = choice.querySelector("input");
      checkbox.disabled = !allowed;
      choice.classList.toggle("disabled", !allowed);
      if (reset) checkbox.checked = allowed;
    });
  };
  syncTools(false);
  modeSelect.addEventListener("change", () => syncTools(true));
  root.querySelector("[data-close-editor]").addEventListener("click", () => (root.innerHTML = ""));
  root.querySelector("#agent-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload = {
      agent_id: data.get("agent_id") || undefined,
      name: data.get("name"),
      description: data.get("description"),
      mode: data.get("mode"),
      kb_id: data.get("kb_id") || null,
      system_prompt: data.get("system_prompt"),
      tools: data.getAll("tools"),
      allow_web_search: data.get("allow_web_search") === "on",
    };
    try {
      if (agent) await api.updateAgent(agent.agent_id, payload);
      else await api.createAgent(payload);
      root.innerHTML = "";
      toast(agent ? "智能体配置已更新" : "智能体已创建", "success");
      await renderAgents();
    } catch (error) {
      showError(error, "保存智能体失败");
    }
  });
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
    const endpoints = ["knowledge-bases", "agents", "agent-stats", "routing/test", "documents/upload", "documents/{id}", "documents", "index/start", "index/status/{id}", "index/result/{id}", "index/jobs/{id}", "kg/nodes", "kg/edges", "kg/nodes/{id}", "kg/nodes/{id}/neighbors", "kg/stats", "kg/export", "query", "query/{id}/feedback", "query/batch", "query/batch/{id}", "query/history", "conversations/{id}/memory", "search/entities", "search/path", "search/graph", "health", "system/stats", "system/formats", "system/demo"];
    $("#api-coverage").innerHTML = `<div class="tag-row">${endpoints.map((item) => `<span class="badge indexed">✓ ${escapeHtml(item)}</span>`).join("")}</div>`;
  } catch (error) {
    showError(error, "系统信息加载失败");
  }
}
