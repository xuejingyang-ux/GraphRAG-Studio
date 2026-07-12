class APIError extends Error {
  constructor(payload, status) {
    const validationMessage = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => item.msg).filter(Boolean).join("；")
      : "";
    super(payload?.msg || validationMessage || "API 请求失败");
    this.name = "APIError";
    this.code = payload?.code ?? 5000;
    this.status = status;
    this.requestId = payload?.request_id;
    this.data = payload?.data;
  }
}

const API_BASE = "/api/v1";

async function apiRequest(path, options = {}) {
  const { timeoutMs = path.startsWith("/query") ? 60000 : 30000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: fetchOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...fetchOptions,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({ code: 5000, msg: "Invalid JSON response" }));
    if (!response.ok || payload.code !== 0) {
      throw new APIError(payload, response.status);
    }
    return payload.data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new APIError({ code: 4001, msg: `请求超时（${Math.round(timeoutMs / 1000)} 秒）` }, 408);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const api = {
  uploadDocument(file, kbId = "kb_technical") {
    const form = new FormData();
    form.append("file", file);
    form.append("kb_id", kbId);
    return apiRequest("/documents/upload", { method: "POST", body: form });
  },
  getDocument(docId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}`);
  },
  listDocuments(params = {}) {
    const query = new URLSearchParams({ page: params.page || 1, page_size: params.page_size || 20 });
    if (params.kb_id) query.set("kb_id", params.kb_id);
    return apiRequest(`/documents?${query}`);
  },
  deleteDocument(docId) {
    return apiRequest(`/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
  },
  startIndex(docId) {
    return apiRequest("/index/start", { method: "POST", body: JSON.stringify({ doc_id: docId }) });
  },
  getIndexStatus(jobId) {
    return apiRequest(`/index/status/${encodeURIComponent(jobId)}`);
  },
  getIndexResult(jobId) {
    return apiRequest(`/index/result/${encodeURIComponent(jobId)}`);
  },
  cancelJob(jobId) {
    return apiRequest(`/index/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  },
  listNodes(params = {}) {
    const query = new URLSearchParams({ page: params.page || 1, page_size: params.page_size || 200 });
    if (params.doc_id) query.set("doc_id", params.doc_id);
    if (params.kb_id) query.set("kb_id", params.kb_id);
    return apiRequest(`/kg/nodes?${query}`);
  },
  listEdges(params = {}) {
    const query = new URLSearchParams({ page: params.page || 1, page_size: params.page_size || 500 });
    if (params.doc_id) query.set("doc_id", params.doc_id);
    if (params.kb_id) query.set("kb_id", params.kb_id);
    return apiRequest(`/kg/edges?${query}`);
  },
  getNode(nodeId) {
    return apiRequest(`/kg/nodes/${encodeURIComponent(nodeId)}`);
  },
  getNeighbors(nodeId, hops = 1) {
    return apiRequest(`/kg/nodes/${encodeURIComponent(nodeId)}/neighbors?hops=${encodeURIComponent(hops)}`);
  },
  getKgStats(kbId = "") {
    return apiRequest(`/kg/stats${kbId ? `?kb_id=${encodeURIComponent(kbId)}` : ""}`);
  },
  exportKg() {
    return apiRequest("/kg/export");
  },
  query(question, history = [], agentId = "auto", kbId = null) {
    return apiRequest("/query", { method: "POST", body: JSON.stringify({ question, history, agent_id: agentId, kb_id: kbId }) });
  },
  queryBatch(questions, agentId = "auto", kbId = null) {
    return apiRequest("/query/batch", { method: "POST", body: JSON.stringify({ questions, agent_id: agentId, kb_id: kbId }) });
  },
  getBatch(batchId) {
    return apiRequest(`/query/batch/${encodeURIComponent(batchId)}`);
  },
  getQueryHistory(params = {}) {
    const query = new URLSearchParams({ page: params.page || 1, page_size: params.page_size || 20 });
    return apiRequest(`/query/history?${query}`);
  },
  searchEntities(q, type = "") {
    const query = new URLSearchParams({ q });
    if (type && type !== "All") query.set("type", type);
    return apiRequest(`/search/entities?${query}`);
  },
  searchPath(fromId, toId, maxHops = 3) {
    const query = new URLSearchParams({ from: fromId, to: toId, max_hops: maxHops });
    return apiRequest(`/search/path?${query}`);
  },
  searchGraph(q, includeNeighbors = true) {
    const query = new URLSearchParams({ q, include_neighbors: includeNeighbors });
    return apiRequest(`/search/graph?${query}`);
  },
  health() {
    return apiRequest("/health");
  },
  systemStats() {
    return apiRequest("/system/stats");
  },
  formats() {
    return apiRequest("/system/formats");
  },
  loadDemo() {
    return apiRequest("/system/demo");
  },
  listKnowledgeBases() {
    return apiRequest("/knowledge-bases");
  },
  listAgents() {
    return apiRequest("/agents");
  },
};
