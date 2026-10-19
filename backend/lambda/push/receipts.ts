// Expo delivery receipts. Each ok ticket is stored as
//   pk = "RECEIPT"  sk = <ticket id>  { deviceId, sentAt }
// and an hourly scheduled run asks Expo for the receipts, deletes devices
// whose receipt says DeviceNotRegistered, and forgets checked tickets.
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "../deps";
import { chunk } from "./types";

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
