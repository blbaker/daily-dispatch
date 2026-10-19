// Everything the handler touches outside its own code, gathered in one place
// so tests can swap any piece.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AwsCreds, lambdaCreds } from "./presign";

export interface Env {
  table: string;
  gsi: string;
  apiKey: string;
  releaseBucket: string;
  mediaBucket: string;
  region: string;
}

export interface Deps {
  ddb: DynamoDBDocumentClient;
  env: Env;
  creds: () => AwsCreds;
  fetch: typeof fetch;
  now: () => Date;
  log: (message: string, detail?: unknown) => void;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    table: e.TABLE_NAME || "",
    gsi: e.GSI_NAME || "byType",
    apiKey: e.API_KEY || "",
    releaseBucket: e.RELEASE_BUCKET || "",
    mediaBucket: e.MEDIA_BUCKET || "",
    region: e.AWS_REGION || "",
  };
}

export function defaultDeps(): Deps {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    ddb,
    env: readEnv(),
    creds: lambdaCreds,
    // Looked up on every call so a replaced global (tests) is honoured.
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => new Date(),
    log: (message, detail) =>
      detail === undefined ? console.log(message) : console.log(message, detail),
  };
}
