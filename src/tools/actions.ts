import { ActionType, type ExecutionResult, type PlannedAction, emptyExecutionResult } from "../data/models.js";
import type { EmailConnector } from "../integrations/email/base.js";
import type { AnyToolDefinition } from "./base.js";

export interface ApplyActionArgs {
  action: PlannedAction;
  dryRun?: boolean;
}

export function createActionTools(connector: EmailConnector): AnyToolDefinition[] {
  return [
    {
      name: "apply_email_action",
      description: "Apply one planned mailbox action. High-impact actions should be called only after confirmation unless dryRun is true.",
      schema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "object" },
          dryRun: { type: "boolean" },
        },
        additionalProperties: false,
      },
      risk: "high",
      invoke(args: ApplyActionArgs): Promise<ExecutionResult> {
        return applyEmailAction(connector, args.action, args.dryRun ?? false);
      },
    },
  ];
}

async function applyEmailAction(
  connector: EmailConnector,
  action: PlannedAction,
  dryRun: boolean,
): Promise<ExecutionResult> {
  const result = emptyExecutionResult(action.emailIds.length);
  if (dryRun) {
    result.notes.push(`dry-run: would ${action.action} ${action.emailIds.length} email(s)`);
    return result;
  }

  switch (action.action) {
    case ActionType.ARCHIVE:
      await connector.archive(action.emailIds);
      result.archived = action.emailIds.length;
      break;
    case ActionType.LABEL:
      if (action.label) {
        await connector.label(action.emailIds, action.label);
        result.labeled = action.emailIds.length;
      } else {
        result.notes.push("label action skipped: missing label");
      }
      break;
    case ActionType.STAR:
      await connector.star(action.emailIds);
      result.starred = action.emailIds.length;
      break;
    case ActionType.MARK_READ:
      await connector.markRead(action.emailIds);
      result.markedRead = action.emailIds.length;
      break;
    case ActionType.DRAFT_REPLY:
      if (action.draftBody) {
        for (const emailId of action.emailIds) {
          await connector.saveDraft(emailId, action.draftBody);
          result.draftsCreated += 1;
        }
      } else {
        result.notes.push("draft action skipped: missing draftBody");
      }
      break;
    case ActionType.KEEP_UNREAD:
    case ActionType.REPORT_ONLY:
      result.notes.push(`no mailbox write needed for ${action.action}`);
      break;
  }

  return result;
}
