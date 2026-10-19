// Expo delivery receipts. Each ok ticket is stored as
//   pk = "RECEIPT"  sk = <ticket id>  { deviceId, sentAt }
// and an hourly scheduled run asks Expo for the receipts, deletes devices
// whose receipt says DeviceNotRegistered, and forgets checked tickets.
// Expo publishes a receipt about 15 minutes after the send and keeps it
// for about a day, which sets the window below.
import { BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "../deps";
import { deleteDevice } from "../devices";
import { chunk } from "./types";

const MIN_AGE_MS = 15 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;

export async function storeTickets(deps: Deps, tickets: { id: string; deviceId: string }[]): Promise<void> {
  const sentAt = deps.now().toISOString();
  for (const batch of chunk(tickets, 25)) {
    await deps.ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [deps.env.table]: batch.map((t) => ({
            PutRequest: { Item: { pk: "RECEIPT", sk: t.id, deviceId: t.deviceId, sentAt } },
          })),
        },
      }),
    );
  }
}

interface ReceiptRow {
  sk: string;
  deviceId: string;
  sentAt: string;
}

async function listReceipts(deps: Deps): Promise<ReceiptRow[]> {
  const out: ReceiptRow[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.env.table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": "RECEIPT" },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((res.Items || []) as ReceiptRow[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

async function forget(deps: Deps, ticketIds: string[]): Promise<void> {
  for (const batch of chunk(ticketIds, 25)) {
    await deps.ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [deps.env.table]: batch.map((sk) => ({ DeleteRequest: { Key: { pk: "RECEIPT", sk } } })),
        },
      }),
    );
  }
}

export interface ReceiptReport {
  checked: number;
  pruned: number;
  expired: number;
  pending: number;
}

export async function checkExpoReceipts(deps: Deps): Promise<ReceiptReport> {
  const now = deps.now().getTime();
  const rows = await listReceipts(deps);
  const age = (r: ReceiptRow) => now - Date.parse(r.sentAt);
  const expired = rows.filter((r) => age(r) > MAX_AGE_MS);
  const due = rows.filter((r) => age(r) >= MIN_AGE_MS && age(r) <= MAX_AGE_MS);

  const { expo } = await deps.push();
  const result = expo.enabled && due.length > 0 ? await expo.checkReceipts(due.map((r) => r.sk)) : { checked: [], unregistered: [] };

  const deviceOf = new Map(rows.map((r) => [r.sk, r.deviceId]));
  const dead = new Set(result.unregistered.map((t) => deviceOf.get(t)).filter((d): d is string => !!d));
  for (const id of dead) await deleteDevice(deps, id);
  await forget(deps, [...result.checked, ...expired.map((r) => r.sk)]);

  const report = {
    checked: result.checked.length,
    pruned: dead.size,
    expired: expired.length,
    pending: rows.length - result.checked.length - expired.length,
  };
  deps.log("push: expo receipt check", report);
  return report;
}
