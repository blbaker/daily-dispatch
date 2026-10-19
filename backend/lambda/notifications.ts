// The notification log: one row per published event, read by desktop
// pollers and written by fan-out.
//   Notification: pk = "NOTIFICATION"  sk = "<ISO createdAt>#<event>#<refId>"
//   Sent marker:  pk = "NOTIFIED"      sk = "<event>#<refId>"
// The marker makes publishing idempotent: the 5 PM job re-posts finished
// editions, and only the first post of each one may notify.
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "./deps";

export type NotificationEvent = "edition" | "episode";

export interface NotificationRecord {
  id: string;
  event: NotificationEvent;
  refId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
}

/** Claims the right to notify for this event; false if it was already claimed. */
export async function claimNotification(deps: Deps, event: NotificationEvent, refId: string): Promise<boolean> {
  try {
    await deps.ddb.send(
      new PutCommand({
        TableName: deps.env.table,
        Item: { pk: "NOTIFIED", sk: `${event}#${refId}`, at: deps.now().toISOString() },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

export async function recordNotification(deps: Deps, rec: NotificationRecord): Promise<void> {
  await deps.ddb.send(
    new PutCommand({
      TableName: deps.env.table,
      Item: { pk: "NOTIFICATION", sk: `${rec.createdAt}#${rec.event}#${rec.refId}`, ...rec },
    }),
  );
}

/**
 * Notifications created strictly after `since`, oldest first. The "#~" suffix
 * sorts after every "<same instant>#<event>" key, so a row at exactly `since`
 * (the caller's previous cursor) is not returned twice.
 */
export async function notificationsSince(
  deps: Deps,
  since: Date,
  limit: number,
): Promise<{ items: NotificationRecord[]; more: boolean }> {
  const res = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.env.table,
      KeyConditionExpression: "pk = :p AND sk > :s",
      ExpressionAttributeValues: { ":p": "NOTIFICATION", ":s": `${since.toISOString()}#~` },
      ScanIndexForward: true,
      Limit: limit,
    }),
  );
  const items = (res.Items || []).map((it) => {
    const { pk: _pk, sk: _sk, ...rec } = it;
    return rec as NotificationRecord;
  });
  return { items, more: !!res.LastEvaluatedKey };
}
