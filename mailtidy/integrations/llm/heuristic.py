"""本地启发式 LLM 回退实现。

它故意做得"够用就行"：用关键词命中给出确定性的判断，让单测可重复。
生产环境应替换为真正的 LLMClient，但保留这个类是有价值的——
断网 / 没 API key / CI 环境下都能让 demo 跑起来，也是 §2.1.4 兜底策略
里 MailTidy 的"最低可用线"。
"""

from __future__ import annotations

import re

from mailtidy.data.models import Category, EmailJudgment, EmailMessage, StyleProfile
from mailtidy.llm.base import LLMClient, ModelProfile


class HeuristicLLMClient(LLMClient):
    """关键词启发式分类器，作为真实 LLM 的最终兜底。"""

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            name="heuristic",
            provider="local",
            supports_tools=False,
            supports_local=True,
        )

    def classify_email(self, message: EmailMessage, custom_dimensions: list[str] | None = None) -> EmailJudgment:
        """根据简单关键词把邮件归类。

        命中顺序按"误判代价"从低到高排：促销最先判（误判最不痛），
        actionable / important 放后面（更需要精准）。
        """
        text = f"{message.sender} {message.subject} {message.snippet}".lower()
        # 兜底分类：未命中关键词时按"通知"处理，置信度故意压低，
        # 让 policy 层不会因此触发归档 / 标已读
        category = Category.NOTIFICATION
        confidence = 0.72
        urgency = 2
        reason = "Looks like a general notification."

        if any(word in text for word in ["off", "sale", "deal", "promo", "discount"]):
            category, confidence, urgency = Category.PROMOTION, 0.91, 1
            reason = "The email is promotional."
        elif any(word in text for word in ["receipt", "charged", "invoice", "payment", "order"]):
            category, confidence, urgency = Category.TRANSACTIONAL, 0.88, 2
            reason = "The email contains billing or transaction language."
        elif any(word in text for word in ["weekly", "newsletter", "digest"]):
            category, confidence, urgency = Category.NEWSLETTER, 0.89, 1
            reason = "The email appears to be subscribed content."
        elif any(word in text for word in ["approve", "reply", "urgent", "today", "action required"]):
            category, confidence, urgency = Category.ACTIONABLE, 0.9, 4
            reason = "The email asks for a concrete action."
        elif any(word in text for word in ["ci failed", "security", "failed", "alert"]):
            category, confidence, urgency = Category.IMPORTANT, 0.86, 4
            reason = "The notification may affect work or security."

        dimensions = self._custom_dimensions(message, category, custom_dimensions or [])
        return EmailJudgment(
            email_id=message.id,
            category=category,
            confidence=confidence,
            urgency=urgency,
            reason=reason,
            action_suggestion=category.value,
            custom_dimensions=dimensions,
        )

    def draft_reply(self, message: EmailMessage, style: StyleProfile) -> str:
        """生成一份保守的占位草稿，故意留 ``[需要你补充]`` 让用户必须看一眼。"""
        opener = style.opening_patterns[0] if style.opening_patterns else "Hi"
        closer = style.closing_patterns[0] if style.closing_patterns else "Best"
        signature = f"\n{style.signature}" if style.signature else ""
        return (
            f"{opener},\n\n"
            f"Thanks for the note. I can help with this, but I need to confirm "
            f"[需要你补充] before giving a final answer.\n\n"
            f"{closer},{signature}"
        )

    def summarize_newsletters(self, messages: list[EmailMessage]) -> str:
        if not messages:
            return "No newsletters found."
        lines = [f"- {message.subject}: {message.snippet}" for message in messages]
        return "\n".join(lines)

    def _custom_dimensions(
        self,
        message: EmailMessage,
        category: Category,
        custom_dimensions: list[str],
    ) -> dict[str, object]:
        """为用户自定义维度填值。

        未识别的维度统一返回 "unknown"，避免 LLM 客户端哑掉时上层拿到 KeyError。
        """
        values: dict[str, object] = {}
        text = f"{message.subject} {message.snippet}".lower()
        for dimension in custom_dimensions:
            key = dimension.strip().lower().replace(" ", "_")
            if key in {"needs_reply", "reply_required"}:
                values[key] = category == Category.ACTIONABLE or bool(re.search(r"\breply\b", text))
            elif key in {"billing", "cost"}:
                values[key] = category == Category.TRANSACTIONAL or "$" in text
            elif key == "project":
                values[key] = "MailTidy" if "mailtidy" in text else "unknown"
            else:
                values[key] = "unknown"
        return values


__all__ = ["HeuristicLLMClient"]
