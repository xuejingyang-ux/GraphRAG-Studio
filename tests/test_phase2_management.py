from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import graphrag_pipeline.api_server as api_server


class PhaseTwoManagementTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        api_server.DATA_DIR, api_server.UPLOAD_DIR, api_server.DB_PATH = self.original_paths
        api_server.SILICONFLOW_API_KEY = self.original_api_key
        self.temp_dir.cleanup()

    def test_knowledge_base_crud_and_occupied_delete_guard(self) -> None:
        created = self.client.post(
            "/api/v1/knowledge-bases",
            json={"kb_id": "kb_finance", "name": "金融知识库", "domain": "finance", "description": "金融测试"},
        )
        self.assertEqual(created.status_code, 200)
        updated = self.client.patch(
            "/api/v1/knowledge-bases/kb_finance",
            json={"name": "金融风控知识库", "description": "更新后的描述"},
        ).json()["data"]
        self.assertEqual(updated["name"], "金融风控知识库")
        agent = self.client.post(
            "/api/v1/agents",
            json={
                "agent_id": "agent_finance",
                "name": "金融智能体",
                "kb_id": "kb_finance",
                "mode": "knowledge_graph",
                "tools": ["resolve_graph_entities", "get_graph_neighbors"],
                "system_prompt": "只能回答金融风控知识。",
            },
        )
        self.assertEqual(agent.status_code, 200)
        blocked = self.client.delete("/api/v1/knowledge-bases/kb_finance")
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("bound", blocked.json()["msg"])
        self.assertEqual(self.client.delete("/api/v1/agents/agent_finance").status_code, 200)
        self.assertEqual(self.client.delete("/api/v1/knowledge-bases/kb_finance").status_code, 200)

    def test_agent_prompt_tools_and_web_permission_are_persisted_and_enforced(self) -> None:
        updated = self.client.patch(
            "/api/v1/agents/agent_medical",
            json={
                "system_prompt": "回答时先说明证据实体。",
                "tools": ["resolve_graph_entities"],
                "allow_web_search": False,
            },
        ).json()["data"]
        self.assertEqual(updated["system_prompt"], "回答时先说明证据实体。")
        self.assertEqual(updated["tools"], ["resolve_graph_entities"])
        result = api_server.answer_question("高血压有哪些症状？", agent_id="agent_medical")
        self.assertEqual(result["agent"], "configuration-blocked")
        self.assertIn("get_graph_neighbors", result["answer"])

        self.client.patch("/api/v1/agents/agent_web", json={"allow_web_search": False})
        web_result = api_server.answer_question("今天的天气如何？", agent_id="agent_web")
        self.assertEqual(web_result["agent"], "configuration-blocked")
        self.assertFalse(web_result["sources"])

    def test_route_test_covers_knowledge_web_general_and_manual_routes(self) -> None:
        cases = [
            ("高血压有哪些症状？", "auto", None, "agent_medical", "kb_medical"),
            ("GraphRAG 的核心技术有哪些？", "auto", None, "agent_technical", "kb_technical"),
            ("今天世界杯有哪些比赛？", "auto", None, "agent_web", None),
            ("请写一句欢迎语", "auto", None, "agent_general", None),
            ("高血压有哪些症状？", "agent_technical", None, "agent_technical", "kb_technical"),
        ]
        for question, agent_id, kb_id, expected_agent, expected_kb in cases:
            with self.subTest(question=question, agent_id=agent_id):
                result = self.client.post(
                    "/api/v1/routing/test",
                    json={"question": question, "agent_id": agent_id, "kb_id": kb_id},
                ).json()["data"]
                self.assertEqual(result["agent_id"], expected_agent)
                self.assertEqual(result["kb_id"], expected_kb)
                self.assertTrue(result["route_reason"])

    def test_independent_graph_endpoints_do_not_leak_between_knowledge_bases(self) -> None:
        medical_nodes = self.client.get("/api/v1/kg/nodes?page_size=5000&kb_id=kb_medical").json()["data"]["items"]
        technical_nodes = self.client.get("/api/v1/kg/nodes?page_size=5000&kb_id=kb_technical").json()["data"]["items"]
        self.assertTrue(medical_nodes)
        self.assertTrue(technical_nodes)
        self.assertTrue(all(node["kb_id"] in {"kb_medical", api_server.SYSTEM_KB_ID} for node in medical_nodes))
        self.assertTrue(all(node["kb_id"] in {"kb_technical", api_server.SYSTEM_KB_ID} for node in technical_nodes))
        self.assertFalse(any(node.get("kb_id") == "kb_technical" for node in medical_nodes))
        self.assertFalse(any(node.get("kb_id") == "kb_medical" for node in technical_nodes))

        medical_edges = self.client.get("/api/v1/kg/edges?page_size=20000&kb_id=kb_medical").json()["data"]["items"]
        self.assertTrue(medical_edges)
        self.assertTrue(all(edge["kb_id"] == "kb_medical" for edge in medical_edges))

        center = next(node for node in medical_nodes if not node.get("is_hub"))
        neighbors = self.client.get(f"/api/v1/kg/nodes/{center['node_id']}/neighbors?hops=3&kb_id=kb_medical").json()["data"]
        self.assertTrue(all(node["kb_id"] in {"kb_medical", api_server.SYSTEM_KB_ID} for node in neighbors["nodes"]))
        self.assertTrue(all(edge["kb_id"] == "kb_medical" for edge in neighbors["edges"]))
        self.assertEqual(
            self.client.get(f"/api/v1/kg/nodes/{center['node_id']}/neighbors?kb_id=kb_technical").status_code,
            404,
        )
        self.assertEqual(
            self.client.get(f"/api/v1/kg/nodes/{center['node_id']}?kb_id=kb_technical").status_code,
            404,
        )

        exported = self.client.get("/api/v1/kg/export?kb_id=kb_medical").json()["data"]
        self.assertEqual(exported["kb_id"], "kb_medical")
        self.assertTrue(all(doc["kb_id"] == "kb_medical" for doc in exported["documents"]))
        self.assertTrue(all(edge["kb_id"] == "kb_medical" for edge in exported["edges"]))


if __name__ == "__main__":
    unittest.main()
