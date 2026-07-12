function parseHash() {
  const raw = location.hash || "#/dashboard";
  const cleaned = raw.replace(/^#\/?/, "");
  const [routePart, queryPart = ""] = cleaned.split("?");
  const route = routePart || "dashboard";
  const params = Object.fromEntries(new URLSearchParams(queryPart));
  return { route, params };
}

async function navigate() {
  const { route, params } = parseHash();
  AppState.currentPage = route;
  activeGraph?.destroy?.();
  previewGraph?.destroy?.();
  $$(".nav-item, .bottom-nav a").forEach((item) => item.classList.toggle("active", item.dataset.route === route));
  $("#sidebar")?.classList.remove("open");
  const renderers = {
    dashboard: renderDashboard,
    "knowledge-bases": renderKnowledgeBases,
    documents: renderDocuments,
    graph: renderGraphPage,
    chat: renderChat,
    agents: renderAgents,
    search: renderSearch,
    system: renderSystem,
  };
  const renderer = renderers[route] || renderDashboard;
  try {
    await renderer(params);
    $("#main")?.focus();
  } catch (error) {
    showError(error, "页面加载失败");
  }
}

function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function initGlobalSearch() {
  const input = $("#global-search-input");
  const popover = $("#global-search-popover");
  if (!input || !popover) return;
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) {
      popover.classList.add("hidden");
      popover.innerHTML = "";
      return;
    }
    try {
      const result = await api.searchEntities(q);
      popover.innerHTML = result.items.slice(0, 5).map((item) => `
        <div class="search-suggestion" data-node="${item.node_id}">
          <span>${escapeHtml(item.name)}</span>
          ${typeBadge(item.type)}
        </div>
      `).join("") || '<div class="search-suggestion"><span class="small">No suggestions</span></div>';
      popover.classList.remove("hidden");
      $$("[data-node]", popover).forEach((node) => {
        node.addEventListener("click", () => {
          input.value = "";
          popover.classList.add("hidden");
          location.hash = `#/graph?node=${encodeURIComponent(node.dataset.node)}`;
        });
      });
    } catch (error) {
      popover.classList.add("hidden");
    }
  }, 300);
  input.addEventListener("input", search);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && input.value.trim()) {
      location.hash = `#/search?q=${encodeURIComponent(input.value.trim())}`;
      input.value = "";
      popover.classList.add("hidden");
    }
    if (event.key === "Escape") {
      popover.classList.add("hidden");
    }
  });
}
