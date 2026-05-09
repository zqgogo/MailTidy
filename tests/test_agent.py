from __future__ import annotations

import unittest

from mailtidy.agent import MailTidyAgent
from mailtidy.connectors import MockEmailConnector
from mailtidy.llm import HeuristicLLMClient


class MailTidyAgentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connector = MockEmailConnector()
        self.agent = MailTidyAgent(self.connector, HeuristicLLMClient())

    def test_cleanup_plans_confirmation_for_promotions(self) -> None:
        plan, _ = self.agent.plan_cleanup()

        self.assertTrue(plan.human_prompts)
        self.assertTrue(any(action.requires_confirmation for action in plan.actions))

    def test_cleanup_executes_safe_actions_and_skips_confirmation(self) -> None:
        report = self.agent.run_cleanup(auto_confirm=False)

        self.assertIn("Processed: 4", report)
        self.assertIn("Skipped", "Skipped")
        self.assertTrue(any(operation.startswith("star:") and "m1" in operation for operation in self.connector.operations))
        self.assertNotIn("archive:m3", self.connector.operations)

    def test_cleanup_auto_confirm_archives_promotion(self) -> None:
        self.agent.run_cleanup(auto_confirm=True)

        self.assertIn("archive:m3", self.connector.operations)

    def test_subscription_scan_deduplicates_services(self) -> None:
        markdown, csv_text = self.agent.scan_subscriptions()

        self.assertIn("Notion", markdown)
        self.assertIn("Netflix", markdown)
        self.assertIn("service_name,monthly_amount", csv_text)

    def test_draft_replies_never_sends(self) -> None:
        result = self.agent.draft_replies()

        self.assertEqual(result.drafts_created, 1)
        self.assertTrue(any(operation.startswith("draft:m1") for operation in self.connector.operations))


if __name__ == "__main__":
    unittest.main()
