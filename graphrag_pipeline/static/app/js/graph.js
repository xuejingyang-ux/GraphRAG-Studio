const TypeColors = {
  ROOT: "#ffffff",
  KNOWLEDGE_BASE: "#21d4a7",
  CATEGORY: "#00f5ff",
  TECHNOLOGY: "#58a6ff",
  CONCEPT: "#bc8cff",
  PERSON: "#3fb950",
  ORGANIZATION: "#ff7b72",
  LOCATION: "#ffa657",
  DISEASE: "#ff6b8a",
  SYMPTOM: "#ffc857",
  TREATMENT: "#53d8a3",
  DRUG: "#4cc9f0",
  DEPARTMENT: "#f38fff",
};

function nodeColor(type) {
  return TypeColors[type] || "#8b949e";
}

function renderGraph(container, nodes, edges, options = {}) {
  const root = typeof container === "string" ? $(container) : container;
  if (!root) return null;
  root.querySelectorAll("svg, canvas.kg-canvas-renderer, .empty-state").forEach((item) => item.remove());
  if (!nodes.length) {
    root.insertAdjacentHTML("beforeend", emptyState("KG 为空", "上传并索引文档后会在这里生成交互式知识图谱。", '<a class="btn btn-primary" href="#/documents">上传并索引 →</a>'));
    return null;
  }

  if (nodes.length > 500) {
    return renderCanvasGraph(root, nodes, edges, options);
  }

  const width = root.clientWidth || 800;
  const height = root.clientHeight || 460;
  const svg = d3.select(root).append("svg").attr("viewBox", [0, 0, width, height]);
  const graphLayer = svg.append("g");
  const edgeData = edges.map((edge) => ({ ...edge }));
  const nodeData = nodes.map((node) => ({ ...node }));
  const zoom = d3.zoom().scaleExtent([0.1, 8]).on("zoom", (event) => graphLayer.attr("transform", event.transform));
  svg.call(zoom);

  const link = graphLayer
    .append("g")
    .attr("stroke", "#8b949e")
    .attr("stroke-opacity", 0.25)
    .selectAll("line")
    .data(edgeData)
    .join("line")
    .attr("stroke-width", (d) => Math.max(1, Math.sqrt(d.weight || 1)));

  const node = graphLayer
    .append("g")
    .selectAll("g")
    .data(nodeData)
    .join("g")
    .attr("class", "kg-node")
    .attr("data-node-id", (d) => d.node_id)
    .style("cursor", "pointer")
    .call(
      d3
        .drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded),
    );

  node
    .append("circle")
    .attr("r", (d) => {
      if (d.hub_level === "root") return 30;
      if (d.hub_level === "knowledge_base") return 25;
      if (d.hub_level === "category") return 22;
      return Math.max(7, Math.min(20, 7 + Math.sqrt(d.degree || 0) * 2));
    })
    .attr("fill", (d) => nodeColor(d.type))
    .attr("stroke", "#f0f6fc")
    .attr("stroke-opacity", 0.35)
    .attr("stroke-width", 1.2);

  node
    .append("text")
    .text((d) => d.name)
    .attr("x", 12)
    .attr("y", 4)
    .attr("fill", "#c9d1d9")
    .attr("font-size", 11)
    .attr("paint-order", "stroke")
    .attr("stroke", "#0f1117")
    .attr("stroke-width", 3);

  node.append("title").text((d) => `${d.name}\n${d.type}\npage ${d.page}\nconfidence ${d.confidence}\ndegree ${d.degree}`);

  const simulation = d3
    .forceSimulation(nodeData)
    .force(
      "link",
      d3
        .forceLink(edgeData)
        .id((d) => d.node_id)
        .distance((d) => (d.relation === "HAS_KNOWLEDGE_BASE" ? 190 : d.relation === "HAS_CATEGORY" ? 150 : d.relation === "INSTANCE_OF" ? 105 : 80))
        .strength((d) => (d.is_hub_edge ? 0.7 : 0.4)),
    )
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "collision",
      d3.forceCollide().radius((d) => {
        if (d.hub_level === "root") return 52;
        if (d.hub_level === "knowledge_base") return 44;
        if (d.hub_level === "category") return 38;
        return Math.max(22, Math.min(38, 18 + Math.sqrt(d.degree || 0) * 2));
      }),
    );

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = d.x;
    d.fy = d.y;
  }

  function focusNode(nodeId) {
    const connected = new Set([nodeId]);
    edgeData.forEach((edge) => {
      const source = typeof edge.source === "object" ? edge.source.node_id : edge.source;
      const target = typeof edge.target === "object" ? edge.target.node_id : edge.target;
      if (source === nodeId) connected.add(target);
      if (target === nodeId) connected.add(source);
    });
    node
      .classed("focused", (d) => d.node_id === nodeId)
      .style("opacity", (d) => (connected.has(d.node_id) ? 1 : 0.1));
    link
      .attr("stroke-opacity", (d) => {
        const source = typeof d.source === "object" ? d.source.node_id : d.source;
        const target = typeof d.target === "object" ? d.target.node_id : d.target;
        return source === nodeId || target === nodeId ? 0.8 : 0.08;
      })
      .attr("stroke", (d) => {
        const source = typeof d.source === "object" ? d.source.node_id : d.source;
        const target = typeof d.target === "object" ? d.target.node_id : d.target;
        return source === nodeId || target === nodeId ? "#00f5ff" : "#8b949e";
      });
    const target = nodeData.find((item) => item.node_id === nodeId);
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      const scale = 1.65;
      const next = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-target.x, -target.y);
      svg.transition().duration(420).call(zoom.transform, next);
    }
  }

  function clearFocus() {
    node.classed("focused", false).style("opacity", 1);
    link.attr("stroke-opacity", 0.25).attr("stroke", "#8b949e");
  }

  node.on("click", (event, d) => {
    event.stopPropagation();
    focusNode(d.node_id);
    options.onNodeClick?.(d);
  });

  svg.on("click", () => {
    clearFocus();
    options.onBlankClick?.();
  });

  function fit() {
    const bounds = graphLayer.node().getBBox();
    const fullWidth = width;
    const fullHeight = height;
    const scale = Math.min(2, 0.85 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight));
    const translate = [fullWidth / 2 - scale * (bounds.x + bounds.width / 2), fullHeight / 2 - scale * (bounds.y + bounds.height / 2)];
    svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
  }

  setTimeout(fit, 600);

  return {
    renderer: "svg",
    svg: svg.node(),
    canvas: null,
    fit,
    zoomIn: () => svg.transition().call(zoom.scaleBy, 1.25),
    zoomOut: () => svg.transition().call(zoom.scaleBy, 0.8),
    focusNode,
    clearFocus,
    destroy: () => simulation.stop(),
  };
}

function renderCanvasGraph(root, nodes, edges, options = {}) {
  const width = root.clientWidth || 800;
  const height = root.clientHeight || 460;
  const pixelRatio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.className = "kg-canvas-renderer";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${nodes.length} 个节点和 ${edges.length} 条关系的知识图谱`);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  root.appendChild(canvas);
  const context = canvas.getContext("2d");
  const nodeData = nodes.map((node) => ({ ...node }));
  const edgeData = edges.map((edge) => ({ ...edge }));
  let transform = d3.zoomIdentity;
  let focusedNodeId = "";
  let draggedNode = null;

  const nodeRadius = (node) => {
    if (node.hub_level === "root") return 22;
    if (node.hub_level === "knowledge_base") return 19;
    if (node.hub_level === "category") return 16;
    return Math.max(4, Math.min(11, 4 + Math.sqrt(node.degree || 0)));
  };
  const endpointId = (endpoint) => (typeof endpoint === "object" ? endpoint.node_id : endpoint);
  const connectedIds = () => {
    const result = new Set(focusedNodeId ? [focusedNodeId] : []);
    if (!focusedNodeId) return result;
    edgeData.forEach((edge) => {
      const source = endpointId(edge.source);
      const target = endpointId(edge.target);
      if (source === focusedNodeId) result.add(target);
      if (target === focusedNodeId) result.add(source);
    });
    return result;
  };

  function draw() {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0f1117";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      pixelRatio * transform.k,
      0,
      0,
      pixelRatio * transform.k,
      pixelRatio * transform.x,
      pixelRatio * transform.y,
    );
    const connected = connectedIds();
    edgeData.forEach((edge) => {
      const source = edge.source;
      const target = edge.target;
      if (!source || !target || source.x == null || target.x == null) return;
      const highlighted = focusedNodeId && (source.node_id === focusedNodeId || target.node_id === focusedNodeId);
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = highlighted ? "rgba(0,245,255,.85)" : "rgba(139,148,158,.16)";
      context.lineWidth = (highlighted ? 1.8 : Math.max(0.45, Math.sqrt(edge.weight || 1) * 0.6)) / transform.k;
      context.stroke();
    });
    nodeData.forEach((node) => {
      if (node.x == null || node.y == null) return;
      const faded = focusedNodeId && !connected.has(node.node_id);
      context.globalAlpha = faded ? 0.12 : 1;
      context.beginPath();
      context.arc(node.x, node.y, nodeRadius(node), 0, Math.PI * 2);
      context.fillStyle = nodeColor(node.type);
      context.fill();
      if (node.node_id === focusedNodeId || node.is_hub) {
        context.strokeStyle = "rgba(240,246,252,.75)";
        context.lineWidth = 1.5 / transform.k;
        context.stroke();
      }
      if (node.is_hub || node.node_id === focusedNodeId || transform.k >= 1.6) {
        context.font = `${Math.max(8, 11 / transform.k)}px sans-serif`;
        context.fillStyle = "#e6edf3";
        context.fillText(node.name, node.x + nodeRadius(node) + 3, node.y + 3);
      }
    });
    context.globalAlpha = 1;
  }

  const simulation = d3
    .forceSimulation(nodeData)
    .force(
      "link",
      d3.forceLink(edgeData)
        .id((node) => node.node_id)
        .distance((edge) => (edge.relation === "HAS_KNOWLEDGE_BASE" ? 150 : edge.relation === "HAS_CATEGORY" ? 120 : edge.relation === "INSTANCE_OF" ? 72 : 45))
        .strength((edge) => (edge.is_hub_edge ? 0.45 : 0.08)),
    )
    .force("charge", d3.forceManyBody().strength(-48))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((node) => nodeRadius(node) + 2).strength(0.5))
    .alphaDecay(0.045)
    .on("tick", draw);

  const selection = d3.select(canvas);
  const zoom = d3.zoom().scaleExtent([0.08, 10]).on("zoom", (event) => {
    transform = event.transform;
    draw();
  });
  selection.call(zoom);

  function graphPoint(event) {
    return transform.invert(d3.pointer(event, canvas));
  }

  selection.call(
    d3.drag()
      .container(canvas)
      .subject((event) => {
        const [x, y] = graphPoint(event.sourceEvent || event);
        return simulation.find(x, y, 28 / transform.k);
      })
      .on("start", (event) => {
        if (!event.subject) return;
        draggedNode = event.subject;
        event.sourceEvent?.stopPropagation();
        if (!event.active) simulation.alphaTarget(0.18).restart();
        draggedNode.fx = draggedNode.x;
        draggedNode.fy = draggedNode.y;
      })
      .on("drag", (event) => {
        if (!draggedNode) return;
        const [x, y] = graphPoint(event.sourceEvent || event);
        draggedNode.fx = x;
        draggedNode.fy = y;
      })
      .on("end", (event) => {
        if (!draggedNode) return;
        if (!event.active) simulation.alphaTarget(0);
        draggedNode.fx = draggedNode.x;
        draggedNode.fy = draggedNode.y;
        draggedNode = null;
      }),
  );

  canvas.addEventListener("click", (event) => {
    const [x, y] = graphPoint(event);
    const hit = simulation.find(x, y, 22 / transform.k);
    if (hit && Math.hypot((hit.x || 0) - x, (hit.y || 0) - y) <= nodeRadius(hit) + 8 / transform.k) {
      focusedNodeId = hit.node_id;
      options.onNodeClick?.(hit);
    } else {
      focusedNodeId = "";
      options.onBlankClick?.();
    }
    draw();
  });

  function focusNode(nodeId) {
    focusedNodeId = nodeId;
    const target = nodeData.find((node) => node.node_id === nodeId);
    if (target?.x != null) {
      transform = d3.zoomIdentity.translate(width / 2 - target.x * 1.4, height / 2 - target.y * 1.4).scale(1.4);
      selection.transition().duration(350).call(zoom.transform, transform);
    }
    draw();
  }

  function clearFocus() {
    focusedNodeId = "";
    draw();
  }

  function fit() {
    const positioned = nodeData.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!positioned.length) return;
    const xExtent = d3.extent(positioned, (node) => node.x);
    const yExtent = d3.extent(positioned, (node) => node.y);
    const graphWidth = Math.max(1, xExtent[1] - xExtent[0]);
    const graphHeight = Math.max(1, yExtent[1] - yExtent[0]);
    const scale = Math.min(2, 0.88 / Math.max(graphWidth / width, graphHeight / height));
    const next = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(xExtent[0] + xExtent[1]) / 2, -(yExtent[0] + yExtent[1]) / 2);
    selection.transition().duration(450).call(zoom.transform, next);
  }

  setTimeout(fit, 900);
  return {
    renderer: "canvas",
    svg: null,
    canvas,
    fit,
    zoomIn: () => selection.transition().call(zoom.scaleBy, 1.25),
    zoomOut: () => selection.transition().call(zoom.scaleBy, 0.8),
    focusNode,
    clearFocus,
    exportPng: (filename = "knowledge-graph.png") => {
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
    },
    destroy: () => simulation.stop(),
  };
}

function renderLegend(container) {
  const root = typeof container === "string" ? $(container) : container;
  root.innerHTML = Object.entries(TypeColors)
    .map(([type, color]) => `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span>${type}</div>`)
    .join("");
}

function exportSvgAsPng(svgNode, filename = "knowledge-graph.png") {
  if (!svgNode) return;
  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(svgNode);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = svgNode.viewBox.baseVal.width || svgNode.clientWidth || 1200;
    canvas.height = svgNode.viewBox.baseVal.height || svgNode.clientHeight || 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
  image.src = url;
}

function exportGraphAsPng(graph, filename = "knowledge-graph.png") {
  if (graph?.renderer === "canvas") graph.exportPng(filename);
  else exportSvgAsPng(graph?.svg, filename);
}

function renderPathChain(root, nodes) {
  if (!nodes.length) {
    root.innerHTML = `<div class="empty-state"><p>No path found between these entities</p></div>`;
    return;
  }
  root.innerHTML = `<div class="path-chain">${nodes
    .map((node, index) => `${index ? "<span>→</span>" : ""}<span class="badge type-${escapeHtml(node.type)}">${escapeHtml(node.name)}</span>`)
    .join("")}</div>`;
}
