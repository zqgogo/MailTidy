# Inbox Cleanup

## When To Use

Use this skill when the user asks to triage, clean, organize, archive, label, or
summarize recent inbox items.

## Workflow

1. List candidate emails with metadata first. Do not read every full body by default.
2. Classify each email by intent, urgency, sender importance, and risk.
3. Apply user rules and memory before proposing actions.
4. Read the original email only when metadata is insufficient, confidence is low,
   or the action could hide something important.
5. Group safe actions separately from actions that need confirmation.
6. Ask the user before destructive, irreversible, or high-risk actions.

## Evidence

- Keep an evidence index with email ids, sender, subject, and classification reason.
- Separate facts found in the email from agent inference.
- Preserve low-confidence items in the report instead of forcing a decision.

## Stop Conditions

- Stop and ask the user if a message appears financial, legal, medical, security
  related, or possibly phishing.
- Stop if repeated tool failures prevent a trustworthy classification.

## Output

Include processed counts, proposed actions, items needing attention, unresolved
uncertainties, and any memory updates suggested by the task.
