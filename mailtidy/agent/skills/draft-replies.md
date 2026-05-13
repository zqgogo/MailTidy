# Draft Replies

## When To Use

Use this skill when the user asks to draft responses for actionable emails.

## Workflow

1. Select emails that clearly require a response.
2. Read the full email and relevant thread context before drafting.
3. Load the user's writing style profile and recent approved examples when available.
4. Draft only from known facts. Use placeholders for missing details.
5. Prefer saving drafts over sending. Never send automatically.
6. Suggest reply, reply-all, or forward only when the thread context supports it.

## Evidence

- Track which email or thread each draft answers.
- Separate facts from inferred intent.
- Preserve any missing information as explicit placeholders.

## Stop Conditions

- Ask the user if the reply involves commitments, money, legal language, medical
  advice, security credentials, or sensitive personal information.
- Stop if thread context is incomplete and the answer could misrepresent the user.

## Output

Return draft text, missing fields, confidence, recommended send mode, and the
evidence used to compose the draft.
