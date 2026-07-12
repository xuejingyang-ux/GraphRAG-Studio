const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusBadge(status) {
  return `<span class="badge ${escapeHtml(status)}">● ${escapeHtml(status)}</span>`;
}

function typeBadge(type) {
  return `<span class="badge type-${escapeHtml(type)}">${escapeHtml(type)}</span>`;
}

function progressBar(value) {
  const width = Math.max(0, Math.min(100, Number(value || 0)));
  return `<div class="progress-bar"><div class="progress-fill" style="width:${width}%"></div></div>`;
}

function toast(message, type = "info") {
  const region = $("#toast-region");
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  region.prepend(node);
  while (region.children.length > 3) {
    region.lastElementChild.remove();
  }
  setTimeout(() => node.remove(), 4000);
}

function showError(error, fallback = "操作失败") {
  if (error instanceof APIError) {
    toast(`${fallback}: ${error.message}`, error.code >= 5000 ? "error" : "warning");
  } else {
    toast(`${fallback}: ${error.message || error}`, "error");
  }
}

function confirmModal(title, body, okText = "确认", danger = false) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal">
          <h2>${escapeHtml(title)}</h2>
          <p class="small">${escapeHtml(body)}</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="cancel">取消</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="ok">${escapeHtml(okText)}</button>
          </div>
        </div>
      </div>
    `;
    const cleanup = (value) => {
      root.innerHTML = "";
      resolve(value);
    };
    root.querySelector('[data-action="cancel"]').addEventListener("click", () => cleanup(false));
    root.querySelector('[data-action="ok"]').addEventListener("click", () => cleanup(true));
    root.querySelector(".modal-overlay").addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-overlay")) cleanup(false);
    });
  });
}

function pageHead(title, subtitle, actions = "") {
  return `
    <section class="page-head">
      <div class="page-title">
        <span class="eyebrow">GraphRAG Studio</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="toolbar">${actions}</div>
    </section>
  `;
}

function emptyState(title, body, action = "") {
  return `
    <div class="empty-state">
      <div class="upload-icon">◉</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="small">${escapeHtml(body)}</p>
      ${action}
    </div>
  `;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function initParticles() {
  const canvas = $("#particle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const palette = ["#00f5ff", "#58a6ff", "#ff3df2"];
  let particles = [];
  let width = 0;
  let height = 0;

  function resize() {
    width = canvas.width = window.innerWidth * window.devicePixelRatio;
    height = canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const count = Math.max(42, Math.min(100, Math.round(window.innerWidth / 16)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45 * window.devicePixelRatio,
      vy: (Math.random() - 0.5) * 0.45 * window.devicePixelRatio,
      r: (Math.random() * 1.5 + 0.7) * window.devicePixelRatio,
      c: palette[Math.floor(Math.random() * palette.length)],
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = 0.62;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j += 1) {
        const q = particles[j];
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const limit = 130 * window.devicePixelRatio;
        if (dist < limit) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = "#00f5ff";
          ctx.globalAlpha = (1 - dist / limit) * 0.22;
          ctx.lineWidth = window.devicePixelRatio;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}

function renderMarkdown(text) {
  if (window.marked) {
    return marked.parse(escapeHtml(text)).replaceAll("&amp;lt;", "&lt;");
  }
  return escapeHtml(text).replaceAll("\n", "<br>");
}
