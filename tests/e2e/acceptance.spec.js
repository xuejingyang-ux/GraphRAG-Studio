const { test, expect } = require("@playwright/test");

test.describe.serial("GraphRAG Studio PRD browser acceptance", () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.get("/api/v1/system/demo");
    expect(response.ok()).toBeTruthy();
  });

  test("F01 shows invalid uploads inline", async ({ page }) => {
    await page.goto("/#/documents");
    await expect(page.locator("#upload-kb option")).toHaveCount(2);
    await expect(page.locator("#upload-kb")).toContainText("医疗知识库");
    await page.locator("#file-input").setInputFiles({ name: "invalid.exe", mimeType: "application/octet-stream", buffer: Buffer.from("bad") });
    await expect(page.locator(".upload-result.error")).toContainText("不支持的文件格式");
  });

  test("F02 renders completed index summaries and document details", async ({ page }) => {
    await page.goto("/#/documents");
    await expect(page.locator('[data-testid="index-result"]').first()).toContainText("nodes");
    await page.locator('[data-action="details"]').first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('[role="dialog"] [data-testid="index-result"]')).toBeVisible();
  });

  test("F04-F06 and >500 nodes use interactive Canvas", async ({ page }) => {
    await page.goto("/#/graph");
    const canvas = page.locator("#kg-canvas canvas.kg-canvas-renderer");
    await expect(canvas).toBeVisible();
    await expect(page.locator("#graph-runtime")).toContainText("CANVAS");
    await expect(page.locator("#kg-canvas > svg")).toHaveCount(0);
  });

  test("F07-F09 sends real conversation history on follow-up questions", async ({ page }) => {
    const queryBodies = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/v1/query") && request.method() === "POST") queryBodies.push(request.postDataJSON());
    });
    await page.goto("/#/chat");
    await page.locator("#chat-input").fill("请介绍一下2型糖尿病。");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/v1/query") && response.request().method() === "POST"),
      page.locator("#send-chat").click(),
    ]);
    await expect(page.locator(".message.ai").last()).toContainText("2型糖尿病");
    await expect(page.locator(".message.ai").last()).toContainText("智能体：医疗知识智能体");
    await expect(page.locator(".message.ai").last()).toContainText("知识库：医疗知识库");
    await page.locator("#chat-input").fill("它常用什么药，应去什么科室？");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/v1/query") && response.request().method() === "POST"),
      page.locator("#send-chat").click(),
    ]);
    await expect(page.locator(".message.ai").last()).toContainText("二甲双胍");
    expect(queryBodies[1].history).toHaveLength(2);
  });

  test("manual agent selection keeps queries inside its bound knowledge base", async ({ page }) => {
    await page.goto("/#/chat");
    await expect(page.locator("#chat-agent option")).toHaveCount(5);
    await page.locator("#chat-agent").selectOption("agent_technical");
    await page.locator("#chat-input").fill("高血压有哪些症状？");
    await page.locator("#send-chat").click();
    const answer = page.locator(".message.ai").last();
    await expect(answer).toContainText("没有找到足够相关的实体");
    await expect(answer).toContainText("智能体：GraphRAG 技术智能体");
    await expect(answer).toContainText("用户手动选择");
  });

  test("agent center lists four agents and opens chat with the chosen agent", async ({ page }) => {
    await page.goto("/#/agents");
    await expect(page.locator("[data-agent-card]")).toHaveCount(4);
    const medical = page.locator('[data-agent-card="agent_medical"]');
    await expect(medical).toContainText("医疗知识智能体");
    await expect(medical).toContainText("医疗知识库");
    await expect(medical).toContainText("resolve_graph_entities");
    await medical.locator('[data-use-agent="agent_medical"]').click();
    await expect(page).toHaveURL(/#\/chat\?agent=agent_medical/);
    await expect(page.locator("#chat-agent")).toHaveValue("agent_medical");
  });

  test("knowledge base manager opens a strictly scoped independent graph", async ({ page }) => {
    await page.goto("/#/knowledge-bases");
    await expect(page.locator("[data-kb-card]")).toHaveCount(2);
    await expect(page.locator('[data-kb-card="kb_medical"]')).toContainText("800 节点");
    await page.locator('[data-kb-graph="kb_medical"]').click();
    await expect(page).toHaveURL(/#\/graph\?kb_id=kb_medical/);
    await expect(page.locator("#graph-kb-filter")).toHaveValue("kb_medical");
    await expect(page.locator("#kg-canvas canvas.kg-canvas-renderer")).toBeVisible();
    const scope = await page.evaluate(() => ({
      kbId: AppState.kg.scope,
      foreignNodes: AppState.kg.nodes.filter((node) => !["kb_medical", "__global__"].includes(node.kb_id)).length,
      foreignEdges: AppState.kg.edges.filter((edge) => edge.kb_id !== "kb_medical").length,
    }));
    expect(scope).toEqual({ kbId: "kb_medical", foreignNodes: 0, foreignEdges: 0 });
  });

  test("agent manager edits prompts, tools and web permission and exposes route testing", async ({ page, request }) => {
    const originalMedical = (await (await request.get("/api/v1/agents/agent_medical")).json()).data;
    const originalWeb = (await (await request.get("/api/v1/agents/agent_web")).json()).data;
    await page.goto("/#/agents");

    await page.locator('[data-edit-agent="agent_medical"]').click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('textarea[name="system_prompt"]').fill("回答前必须说明知识库证据。");
    await dialog.locator('input[name="tools"][value="search_path"]').uncheck();
    await dialog.locator('button[type="submit"]').click();
    await expect(page.locator('[data-agent-card="agent_medical"] .prompt-preview')).toContainText("回答前必须说明知识库证据");
    await expect(page.locator('[data-agent-card="agent_medical"]')).not.toContainText("search_path");

    await page.locator('[data-edit-agent="agent_web"]').click();
    await page.locator('[role="dialog"] input[name="allow_web_search"]').uncheck();
    await page.locator('[role="dialog"] button[type="submit"]').click();
    await expect(page.locator('[data-agent-card="agent_web"]')).toContainText("禁止联网");

    await page.locator("#route-test-question").fill("高血压有哪些症状？");
    await page.locator("#run-route-test").click();
    await expect(page.locator("#route-test-result")).toContainText("医疗知识智能体");
    await expect(page.locator("#route-test-result")).toContainText("医疗知识库");

    await request.patch("/api/v1/agents/agent_medical", { data: {
      system_prompt: originalMedical.system_prompt,
      tools: originalMedical.tools,
      allow_web_search: originalMedical.allow_web_search,
    } });
    await request.patch("/api/v1/agents/agent_web", { data: {
      system_prompt: originalWeb.system_prompt,
      tools: originalWeb.tools,
      allow_web_search: originalWeb.allow_web_search,
    } });
  });

  test("hybrid mode labels web answers and renders clickable sources", async ({ page }) => {
    await page.route("**/api/v1/query", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          code: 0,
          msg: "ok",
          request_id: "test",
          data: {
            query_id: "qry_web",
            question: "今天踢世界杯的球队名称",
            answer: "根据实时赛程，A队对阵B队。[1]",
            cited_nodes: [],
            tool_calls: [{ tool: "web_search", input: {}, output: { count: 1 } }],
            duration: 0.2,
            history_turns: 0,
            agent: "web-search+llm",
            answer_mode: "web_search",
            sources: [{ title: "今日赛程", url: "https://example.com/schedule", snippet: "A队对阵B队" }],
          },
        }),
      });
    });
    await page.goto("/#/chat");
    await page.locator("#chat-input").fill("今天踢世界杯的球队名称");
    await page.locator("#send-chat").click();
    await expect(page.locator(".message.ai").last()).toContainText("模式：联网检索");
    await expect(page.locator(".answer-sources a")).toHaveAttribute("href", "https://example.com/schedule");
  });

  test("F10-F12 search and batch API flows are reachable", async ({ page }) => {
    await page.goto("/#/search?q=高血压");
    await expect(page.locator("#entity-results")).toContainText("高血压");
    await page.goto("/#/chat");
    await page.locator("#chat-input").fill("高血压有哪些症状？\n糖尿病常用什么药？");
    await page.locator("#batch-chat").click();
    await expect(page.locator(".message.user")).toHaveCount(2);
    await expect(page.locator(".message.ai")).toHaveCount(2);
  });

  test("subgraph search automatically centers and highlights the first match", async ({ page }) => {
    await page.goto(`/#/search?tab=graph&q=${encodeURIComponent("高血压")}`);
    const firstMatch = page.locator(".graph-match").first();
    await expect(firstMatch).toContainText("高血压");
    await expect(firstMatch).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#graph-search-preview .kg-node.focused")).toHaveCount(1);
    await expect(page.locator("#graph-search-preview > svg > g")).toHaveAttribute("transform", /scale\(1\.65\)/);
  });

  test("performance: 40 nodes and 780 edges initialize under 500ms", async ({ page }) => {
    await page.goto("/#/graph");
    await expect(page.locator("#kg-canvas")).toBeVisible();
    const result = await page.evaluate(() => {
      activeGraph?.destroy?.();
      const nodes = Array.from({ length: 40 }, (_, index) => ({
        node_id: `perf_${index}`,
        name: `Node ${index}`,
        type: "CONCEPT",
        degree: 39,
        confidence: "exact",
        page: 1,
      }));
      const edges = [];
      for (let left = 0; left < 40; left += 1) {
        for (let right = left + 1; right < 40; right += 1) {
          edges.push({ source: `perf_${left}`, target: `perf_${right}`, relation: "CO_OCCURS_IN", weight: 1 });
        }
      }
      const started = performance.now();
      const graph = renderGraph("#kg-canvas", nodes, edges);
      const duration = performance.now() - started;
      const renderer = graph.renderer;
      graph.destroy();
      return { duration, renderer, edgeCount: edges.length };
    });
    expect(result.edgeCount).toBe(780);
    expect(result.renderer).toBe("svg");
    expect(result.duration).toBeLessThan(500);
  });

  test("performance: the Canvas threshold is exactly above 500 nodes", async ({ page }) => {
    await page.goto("/#/graph");
    await expect(page.locator("#kg-canvas")).toBeVisible();
    const renderer = await page.evaluate(() => {
      activeGraph?.destroy?.();
      const nodes = Array.from({ length: 501 }, (_, index) => ({
        node_id: `large_${index}`,
        name: `Node ${index}`,
        type: "CONCEPT",
        degree: 0,
        confidence: "exact",
        page: 1,
      }));
      const graph = renderGraph("#kg-canvas", nodes, []);
      const result = graph.renderer;
      graph.destroy();
      return result;
    });
    expect(renderer).toBe("canvas");
    await expect(page.locator("#kg-canvas canvas.kg-canvas-renderer")).toHaveCount(1);
  });

  test("F15 mobile layout exposes bottom navigation", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto("/#/graph");
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator("#sidebar")).toBeHidden();
    await expect(page.locator("#kg-canvas canvas.kg-canvas-renderer")).toBeVisible();
  });
});
