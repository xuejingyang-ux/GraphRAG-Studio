from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import graphrag_pipeline.api_server as api_server
from fastapi.testclient import TestClient


class MedicalQuestionAnsweringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_paths = (api_server.DATA_DIR, api_server.UPLOAD_DIR, api_server.DB_PATH)
        self.original_api_key = api_server.SILICONFLOW_API_KEY
        api_server.DATA_DIR = Path(self.temp_dir.name)
        api_server.UPLOAD_DIR = api_server.DATA_DIR / "uploads"
        api_server.DB_PATH = api_server.DATA_DIR / "store.json"
        api_server.SILICONFLOW_API_KEY = ""
        api_server.seed_demo_data()

    def tearDown(self) -> None:
        api_server.DATA_DIR, api_server.UPLOAD_DIR, api_server.DB_PATH = self.original_paths
        api_server.SILICONFLOW_API_KEY = self.original_api_key
        self.temp_dir.cleanup()

    def test_medical_suggested_questions_return_structured_answers(self) -> None:
        cases = [
            (
                "高血压有哪些常见症状和治疗方法？",
                ("高血压", "常见症状", "治疗原则", "头痛", "生活方式干预"),
            ),
            (
                "出现持续咳嗽和发热应该考虑哪些疾病？",
                ("同时关联发热、咳嗽的疾病", "相关疾病", "急性支气管炎", "社区获得性肺炎"),
            ),
            (
                "糖尿病常用哪些药物，应前往什么科室？",
                ("1型糖尿病", "2型糖尿病", "常用药物", "二甲双胍", "内分泌科"),
            ),
        ]

        for question, expected_fragments in cases:
            with self.subTest(question=question):
                answer, cited_nodes, _tool_calls = api_server.graph_answer(question)
                self.assertNotIn("没有找到足够相关的实体", answer)
                for fragment in expected_fragments:
                    self.assertIn(fragment, answer)
                self.assertNotIn("不能替代医生诊断", answer)
                self.assertTrue(cited_nodes)

        hypertension_answer, _cited_nodes, _tool_calls = api_server.graph_answer(
            "高血压有哪些常见症状和治疗方法？"
        )
        self.assertNotIn("二甲双胍", hypertension_answer)

    def test_repeated_department_keeps_edges_to_each_disease_page(self) -> None:
        _doc, nodes, edges = api_server.build_medical_demo_data()
        nodes_by_name = {node["name"]: node for node in nodes}
        department_id = nodes_by_name["内分泌科"]["node_id"]
        connected_pairs = {
            frozenset((edge["source"], edge["target"]))
            for edge in edges
        }

        for disease_name in ("1型糖尿病", "2型糖尿病"):
            disease_id = nodes_by_name[disease_name]["node_id"]
            self.assertIn(frozenset((disease_id, department_id)), connected_pairs)

    def test_query_api_returns_citations_for_generic_diabetes_name(self) -> None:
        response = TestClient(api_server.app).post(
            "/api/v1/query",
            json={"question": "糖尿病常用哪些药物，应前往什么科室？", "history": []},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["code"], 0)
        self.assertIn("内分泌科", payload["data"]["answer"])
        self.assertIn("二甲双胍", payload["data"]["answer"])
        self.assertTrue(payload["data"]["cited_nodes"])

    def test_medical_notice_is_removed_from_model_style_answer(self) -> None:
        answer = "知识图谱回答。\n\n**【医疗提示】**\n\n以上内容不能替代医生诊断或个体化处方。"
        self.assertEqual(api_server.strip_medical_notice(answer), "知识图谱回答。")

    def test_type_hubs_connect_the_whole_graph(self) -> None:
        db = api_server.load_db()
        root = next(node for node in db["nodes"] if node.get("hub_level") == "root")
        disease_hub = next(
            node
            for node in db["nodes"]
            if node.get("hub_level") == "category" and node.get("entity_type") == "DISEASE"
        )
        disease_ids = {
            node["node_id"]
            for node in db["nodes"]
            if node.get("type") == "DISEASE" and not node.get("is_hub")
        }
        disease_neighbors = set()
        adjacency: dict[str, set[str]] = {}
        for edge in db["edges"]:
            adjacency.setdefault(edge["source"], set()).add(edge["target"])
            adjacency.setdefault(edge["target"], set()).add(edge["source"])
            if disease_hub["node_id"] in (edge["source"], edge["target"]):
                disease_neighbors.add(edge["target"] if edge["source"] == disease_hub["node_id"] else edge["source"])

        self.assertTrue(disease_ids)
        self.assertTrue(disease_ids.issubset(disease_neighbors))

        visited = {root["node_id"]}
        pending = [root["node_id"]]
        while pending:
            current = pending.pop()
            for neighbor in adjacency.get(current, set()) - visited:
                visited.add(neighbor)
                pending.append(neighbor)
        self.assertEqual(visited, {node["node_id"] for node in db["nodes"]})

    def test_follow_up_question_uses_conversation_history(self) -> None:
        response = TestClient(api_server.app).post(
            "/api/v1/query",
            json={
                "question": "它常用哪些药物，应前往什么科室？",
                "history": [
                    {"role": "user", "content": "请介绍一下2型糖尿病。"},
                    {"role": "assistant", "content": "2型糖尿病是图谱中的疾病实体。"},
                ],
            },
        )
        payload = response.json()["data"]
        self.assertEqual(payload["history_turns"], 2)
        self.assertEqual(payload["agent"], "deterministic-react-fallback")
        self.assertIn("二甲双胍", payload["answer"])
        self.assertIn("内分泌科", payload["answer"])

    def test_structured_medical_data_has_semantic_relations(self) -> None:
        _doc, nodes, edges = api_server.build_medical_demo_data()
        node_names = {node["node_id"]: node["name"] for node in nodes}
        semantic = {
            (node_names.get(edge["source"]), edge["relation"], node_names.get(edge["target"]))
            for edge in edges
            if edge.get("semantic")
        }
        self.assertIn(("高血压", "HAS_SYMPTOM", "头痛"), semantic)
        self.assertIn(("2型糖尿病", "TREATED_WITH", "二甲双胍"), semantic)
        self.assertIn(("2型糖尿病", "VISITS_DEPARTMENT", "内分泌科"), semantic)
        self.assertGreater(len(semantic), 20)

    def test_hybrid_router_prefers_knowledge_graph_when_entity_exists(self) -> None:
        result = api_server.answer_question("高血压有哪些症状？")
        self.assertEqual(result["answer_mode"], "knowledge_graph")
        self.assertEqual(result["agent_id"], "agent_medical")
        self.assertEqual(result["kb_id"], "kb_medical")
        self.assertTrue(result["cited_nodes"])

    def test_hybrid_router_uses_web_search_for_realtime_question(self) -> None:
        api_server.SILICONFLOW_API_KEY = "test-key"
        sources = [{"title": "今日赛程", "url": "https://example.com/schedule", "snippet": "A队对阵B队"}]
        with (
            patch.object(api_server, "web_search_results", return_value=sources),
            patch.object(api_server, "call_general_model", return_value="今天由A队对阵B队。[1]"),
        ):
            result = api_server.answer_question("今天踢世界杯的球队名称")
        self.assertEqual(result["answer_mode"], "web_search")
        self.assertEqual(result["agent"], "web-search+llm")
        self.assertEqual(result["sources"], sources)
        self.assertEqual(result["tool_calls"][0]["tool"], "web_search")
        self.assertEqual(result["agent_id"], "agent_web")

    def test_hybrid_router_uses_general_model_for_non_graph_question(self) -> None:
        api_server.SILICONFLOW_API_KEY = "test-key"
        with patch.object(api_server, "call_general_model", return_value="这是通用模型答案。"):
            result = api_server.answer_question("请解释量子纠缠的基本概念")
        self.assertEqual(result["answer_mode"], "general_llm")
        self.assertEqual(result["agent"], "general-llm")
        self.assertEqual(result["answer"], "这是通用模型答案。")
        self.assertEqual(result["agent_id"], "agent_general")

    def test_auto_router_selects_technical_agent(self) -> None:
        result = api_server.answer_question("GraphRAG 使用了哪些核心技术？")
        self.assertEqual(result["agent_id"], "agent_technical")
        self.assertEqual(result["kb_id"], "kb_technical")
        self.assertIn("自动路由", result["route_reason"])

    def test_manual_agent_selection_enforces_knowledge_base_scope(self) -> None:
        result = api_server.answer_question("高血压有哪些症状？", agent_id="agent_technical")
        self.assertEqual(result["agent_id"], "agent_technical")
        self.assertEqual(result["kb_id"], "kb_technical")
        self.assertFalse(result["cited_nodes"])
        self.assertIn("没有找到足够相关的实体", result["answer"])

    def test_knowledge_base_search_does_not_leak_entities(self) -> None:
        self.assertFalse(api_server.find_entities_in_question("高血压", kb_id="kb_technical"))
        self.assertFalse(api_server.find_entities_in_question("GraphRAG", kb_id="kb_medical"))

    def test_every_document_node_and_edge_has_kb_id(self) -> None:
        db = api_server.load_db()
        self.assertTrue(all(item.get("kb_id") for item in db["documents"]))
        self.assertTrue(all(item.get("kb_id") for item in db["nodes"]))
        self.assertTrue(all(item.get("kb_id") for item in db["edges"]))


if __name__ == "__main__":
    unittest.main()
