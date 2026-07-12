from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import graphrag_pipeline.api_server as api_server


class PRDAcceptanceTests(unittest.TestCase):
    """Executable checks mapped one-to-one to PRD acceptance items F01-F15."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_paths = (api_server.DATA_DIR, api_server.UPLOAD_DIR, api_server.DB_PATH)
        self.original_api_key = api_server.SILICONFLOW_API_KEY
        api_server.DATA_DIR = Path(self.temp_dir.name)
        api_server.UPLOAD_DIR = api_server.DATA_DIR / "uploads"
        api_server.DB_PATH = api_server.DATA_DIR / "store.json"
        api_server.SILICONFLOW_API_KEY = ""
        api_server.seed_demo_data()
        self.client = TestClient(api_server.app)
        self.static_dir = api_server.STATIC_DIR

    def tearDown(self) -> None:
        api_server.DATA_DIR, api_server.UPLOAD_DIR, api_server.DB_PATH = self.original_paths
        api_server.SILICONFLOW_API_KEY = self.original_api_key
        self.temp_dir.cleanup()

    def test_f01_upload_validation_and_inline_feedback(self) -> None:
        response = self.client.post("/api/v1/documents/upload", files={"file": ("bad.exe", b"bad")})
        self.assertEqual(response.json()["code"], 1002)
        pages = (self.static_dir / "js" / "pages.js").read_text(encoding="utf-8")
        self.assertIn('class="upload-result error"', pages)
        self.assertIn("200 * 1024 * 1024", pages)

    def test_upload_assigns_selected_knowledge_base(self) -> None:
        response = self.client.post(
            "/api/v1/documents/upload",
            data={"kb_id": "kb_medical"},
            files={"file": ("medical.html", b"<p>medical</p>", "text/html")},
        )
        self.assertEqual(response.json()["data"]["kb_id"], "kb_medical")

    def test_builtin_knowledge_bases_and_agents_are_available(self) -> None:
        knowledge_bases = self.client.get("/api/v1/knowledge-bases").json()["data"]
        agents = self.client.get("/api/v1/agents").json()["data"]
        self.assertEqual({item["kb_id"] for item in knowledge_bases["items"]}, {"kb_medical", "kb_technical"})
        self.assertEqual(
            {item["agent_id"] for item in agents["items"]},
            {"agent_medical", "agent_technical", "agent_web", "agent_general"},
        )

    def test_f02_index_progress_and_result(self) -> None:
        upload = self.client.post(
            "/api/v1/documents/upload",
            files={"file": ("sample.html", b"<h1>GraphRAG uses RAG technology</h1>", "text/html")},
        ).json()["data"]
        job = self.client.post("/api/v1/index/start", json={"doc_id": upload["doc_id"]}).json()["data"]
        status = self.client.get(f"/api/v1/index/status/{job['job_id']}").json()["data"]
        self.assertEqual(status["status"], "done")
        result = self.client.get(f"/api/v1/index/result/{job['job_id']}").json()["data"]
        self.assertIn("nodes", result)
        self.assertIn("duration", result)

    def test_f03_cancel_index_job(self) -> None:
        def add_job(db):
            db["documents"].append({"doc_id": "doc_cancel", "status": "indexing", "path": ""})
            db["jobs"].append({"job_id": "job_cancel", "doc_id": "doc_cancel", "status": "indexing"})

        api_server.mutate_db(add_job)
        payload = self.client.delete("/api/v1/index/jobs/job_cancel").json()["data"]
        self.assertEqual(payload["status"], "cancelled")

    def test_f04_graph_render_data(self) -> None:
        nodes = self.client.get("/api/v1/kg/nodes?page_size=5000").json()["data"]
        edges = self.client.get("/api/v1/kg/edges?page_size=20000").json()["data"]
        self.assertGreater(nodes["total"], 0)
        self.assertGreater(edges["total"], 0)

    def test_f05_graph_highlight_code(self) -> None:
        graph = (self.static_dir / "js" / "graph.js").read_text(encoding="utf-8")
        self.assertIn("function focusNode(nodeId)", graph)
        self.assertIn("connectedIds", graph)

    def test_f06_node_detail_and_neighbors(self) -> None:
        node = api_server.search_entities_raw("高血压", "DISEASE", 1)[0]
        detail = self.client.get(f"/api/v1/kg/nodes/{node['node_id']}").json()["data"]
        neighbors = self.client.get(f"/api/v1/kg/nodes/{node['node_id']}/neighbors?hops=1").json()["data"]
        self.assertEqual(detail["name"], "高血压")
        self.assertGreater(len(neighbors["nodes"]), 1)

    def test_f07_answer_and_multi_turn_metadata(self) -> None:
        payload = self.client.post(
            "/api/v1/query",
            json={"question": "高血压有哪些症状？", "history": [{"role": "user", "content": "我们讨论高血压。"}]},
        ).json()["data"]
        self.assertIn("高血压", payload["answer"])
        self.assertEqual(payload["history_turns"], 1)

    def test_f08_tool_calls_are_real_observations(self) -> None:
        payload = self.client.post("/api/v1/query", json={"question": "高血压有哪些症状？"}).json()["data"]
        self.assertTrue(payload["tool_calls"])
        self.assertTrue(all("tool" in item and "output" in item for item in payload["tool_calls"]))

    def test_f09_answer_has_cited_nodes(self) -> None:
        payload = self.client.post("/api/v1/query", json={"question": "糖尿病常用哪些药物？"}).json()["data"]
        self.assertTrue(payload["cited_nodes"])

    def test_f10_entity_search(self) -> None:
        payload = self.client.get("/api/v1/search/entities", params={"q": "高血压"}).json()["data"]
        self.assertEqual(payload["items"][0]["name"], "高血压")

    def test_subgraph_neighbor_expansion_is_strictly_one_hop(self) -> None:
        payload = self.client.get(
            "/api/v1/search/graph",
            params={"q": "高血压", "include_neighbors": "true"},
        ).json()["data"]
        names = {node["name"] for node in payload["nodes"]}
        self.assertIn("高血压", names)
        self.assertIn("疾病", names)
        self.assertNotIn("2型糖尿病", names)
        self.assertLess(len(payload["nodes"]), 100)

    def test_f11_path_search(self) -> None:
        source = api_server.search_entities_raw("高血压", "DISEASE", 1)[0]
        target = api_server.search_entities_raw("头痛", "SYMPTOM", 1)[0]
        payload = self.client.get(
            "/api/v1/search/path",
            params={"from": source["node_id"], "to": target["node_id"], "max_hops": 3},
        ).json()["data"]
        self.assertGreaterEqual(len(payload["nodes"]), 2)

    def test_f12_all_previously_unused_api_wrappers_have_ui_flows(self) -> None:
        pages = (self.static_dir / "js" / "pages.js").read_text(encoding="utf-8")
        for call in ("api.getDocument(", "api.getIndexResult(", "api.getKgStats(", "api.queryBatch(", "api.getBatch("):
            with self.subTest(call=call):
                self.assertIn(call, pages)

    def test_f13_toast_limit_and_duration(self) -> None:
        ui = (self.static_dir / "js" / "ui.js").read_text(encoding="utf-8")
        self.assertIn("region.children.length > 3", ui)
        self.assertIn("4000", ui)

    def test_f14_empty_states(self) -> None:
        ui = (self.static_dir / "js" / "ui.js").read_text(encoding="utf-8")
        pages = (self.static_dir / "js" / "pages.js").read_text(encoding="utf-8")
        self.assertIn("function emptyState", ui)
        self.assertIn('emptyState("KG 为空"', pages)

    def test_f15_mobile_navigation_and_breakpoint(self) -> None:
        html = (self.static_dir / "index.html").read_text(encoding="utf-8")
        css = (self.static_dir / "css" / "layout.css").read_text(encoding="utf-8")
        self.assertIn('class="bottom-nav"', html)
        self.assertIn("@media (max-width: 768px)", css)


if __name__ == "__main__":
    unittest.main()
