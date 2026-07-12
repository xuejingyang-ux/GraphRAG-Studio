from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import graphrag_pipeline.api_server as api_server


class PhaseThreeCollaborationTests(unittest.TestCase):
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

    def test_supervisor_automatically_collaborates_across_two_knowledge_bases(self) -> None:
        result = self.client.post(
            "/api/v1/query",
            json={
                "question": "比较高血压的常见症状与 GraphRAG 的核心技术",
                "agent_id": "auto",
                "conversation_id": "conv_cross_test",
            },
        ).json()["data"]
        self.assertTrue(result["cross_kb"])
        self.assertEqual(result["answer_mode"], "multi_agent")
        self.assertEqual(result["agent_id"], "supervisor_multi_agent")
        self.assertEqual(
            {item["agent_id"] for item in result["collaborating_agents"]},
            {"agent_medical", "agent_technical"},
        )
        self.assertEqual(len(result["agent_metrics"]), 2)
        self.assertEqual(len([call for call in result["tool_calls"] if call["tool"] == "delegate_to_agent"]), 2)
        self.assertIn("医疗知识智能体", result["answer"])
        self.assertIn("GraphRAG 技术智能体", result["answer"])

        route = self.client.post(
            "/api/v1/routing/test",
            json={"question": "比较高血压与 GraphRAG", "agent_id": "auto"},
        ).json()["data"]
        self.assertTrue(route["cross_kb"])
        self.assertEqual(route["mode"], "multi_agent")
        self.assertEqual(len(route["collaborators"]), 2)

    def test_backend_agent_memory_resolves_follow_up_without_frontend_history(self) -> None:
        conversation_id = "conv_memory_test"
        first = self.client.post(
            "/api/v1/query",
            json={"question": "2型糖尿病有哪些症状？", "conversation_id": conversation_id},
        ).json()["data"]
        self.assertFalse(first["memory_used"])

        follow_up = self.client.post(
            "/api/v1/query",
            json={"question": "它常用什么药，应该去什么科室？", "conversation_id": conversation_id, "history": []},
        ).json()["data"]
        self.assertTrue(follow_up["memory_used"])
        self.assertGreaterEqual(follow_up["memory_turns"], 2)
        self.assertIn("二甲双胍", follow_up["answer"])
        self.assertIn("内分泌科", follow_up["answer"])

        memory = self.client.get(f"/api/v1/conversations/{conversation_id}/memory").json()["data"]
        self.assertEqual(memory["total"], 1)
        self.assertEqual(memory["items"][0]["agent_id"], "agent_medical")
        self.assertEqual(len(memory["items"][0]["turns"]), 4)
        cleared = self.client.delete(f"/api/v1/conversations/{conversation_id}/memory").json()["data"]
        self.assertEqual(cleared["deleted"], 1)

    def test_feedback_based_accuracy_and_latency_statistics(self) -> None:
        first = self.client.post(
            "/api/v1/query",
            json={"question": "高血压有哪些症状？", "conversation_id": "conv_stats_1"},
        ).json()["data"]
        before_feedback = {
            item["agent_id"]: item for item in self.client.get("/api/v1/agent-stats").json()["data"]["items"]
        }["agent_medical"]
        self.assertEqual(before_feedback["call_count"], 1)
        self.assertIsNone(before_feedback["accuracy"])
        self.assertEqual(self.client.post(f"/api/v1/query/{first['query_id']}/feedback", json={"accurate": True}).status_code, 200)

        second = self.client.post(
            "/api/v1/query",
            json={"question": "糖尿病常用什么药？", "conversation_id": "conv_stats_2"},
        ).json()["data"]
        self.client.post(f"/api/v1/query/{second['query_id']}/feedback", json={"accurate": False})
        stats = {
            item["agent_id"]: item for item in self.client.get("/api/v1/agent-stats").json()["data"]["items"]
        }["agent_medical"]
        self.assertEqual(stats["call_count"], 2)
        self.assertEqual(stats["rated_count"], 2)
        self.assertEqual(stats["accurate_count"], 1)
        self.assertEqual(stats["accuracy"], 50.0)
        self.assertGreaterEqual(stats["average_latency"], 0)

    def test_collaborative_feedback_is_attributed_to_each_participating_agent(self) -> None:
        result = self.client.post(
            "/api/v1/query",
            json={"question": "比较高血压与 GraphRAG", "conversation_id": "conv_collab_stats"},
        ).json()["data"]
        self.client.post(f"/api/v1/query/{result['query_id']}/feedback", json={"accurate": True})
        stats = {
            item["agent_id"]: item for item in self.client.get("/api/v1/agent-stats").json()["data"]["items"]
        }
        for agent_id in ("agent_medical", "agent_technical"):
            self.assertEqual(stats[agent_id]["call_count"], 1)
            self.assertEqual(stats[agent_id]["accuracy"], 100.0)
        memory = self.client.get("/api/v1/conversations/conv_collab_stats/memory").json()["data"]
        self.assertEqual({item["agent_id"] for item in memory["items"]}, {"agent_medical", "agent_technical"})


if __name__ == "__main__":
    unittest.main()
