// Push credentials. Each one is read from the environment directly (handy
// for local runs) or, in the deployed stack, from the SSM parameter named by
// <NAME>_PARAM. Nothing here throws: a missing or unreadable credential only
// leaves the provider that needs it disabled, with a log line saying why.
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Log } from "./types";

export const PUSH_SECRETS = ["EXPO_ACCESS_TOKEN", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
export type PushSecretName = (typeof PUSH_SECRETS)[number];
export type PushSecrets = Partial<Record<PushSecretName, string>>;

export async function loadPushSecrets(
  env: Record<string, string | undefined>,
  ssm: Pick<SSMClient, "send">,
  log: Log,
): Promise<PushSecrets> {
  const out: PushSecrets = {};
  const byParam = new Map<string, PushSecretName>();
  for (const name of PUSH_SECRETS) {
    const direct = env[name];
    const param = env[`${name}_PARAM`];
    if (direct) out[name] = direct;
    else if (param) byParam.set(param, name);
  }
  if (byParam.size === 0) return out;

  try {
    const res = await ssm.send(new GetParametersCommand({ Names: [...byParam.keys()], WithDecryption: true }));
    for (const p of res.Parameters ?? []) {
      const name = p.Name ? byParam.get(p.Name) : undefined;
      if (name && p.Value) out[name] = p.Value;
    }
    for (const missing of res.InvalidParameters ?? []) {
      log(`push: SSM parameter ${missing} not found; ${byParam.get(missing)} stays unset`);
    }
  } catch (err) {
    const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log(`push: could not read SSM parameters (${why}); push providers that need them stay disabled`);
  }
  return out;
}
