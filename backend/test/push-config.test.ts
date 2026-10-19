import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { loadPushSecrets } from "../lambda/push/config";

const ssm = mockClient(SSMClient);
const client = () => new SSMClient({ region: "us-west-2" });

beforeEach(() => ssm.reset());

describe("loadPushSecrets", () => {
  it("uses values set directly in the environment without calling SSM", async () => {
    const s = await loadPushSecrets({ EXPO_ACCESS_TOKEN: "direct" }, client(), vi.fn());
    expect(s).toEqual({ EXPO_ACCESS_TOKEN: "direct" });
    expect(ssm.calls()).toHaveLength(0);
  });

  it("reads *_PARAM names from SSM in one decrypted call", async () => {
    ssm.on(GetParametersCommand).resolves({
      Parameters: [
        { Name: "/dd/push/expo", Value: "from-ssm" },
        { Name: "/dd/push/vapid-private", Value: "priv" },
      ],
    });
    const s = await loadPushSecrets(
      { EXPO_ACCESS_TOKEN_PARAM: "/dd/push/expo", VAPID_PRIVATE_KEY_PARAM: "/dd/push/vapid-private" },
      client(),
      vi.fn(),
    );
    expect(s).toEqual({ EXPO_ACCESS_TOKEN: "from-ssm", VAPID_PRIVATE_KEY: "priv" });
    const input = ssm.commandCalls(GetParametersCommand)[0].args[0].input;
    expect(input).toEqual({ Names: ["/dd/push/expo", "/dd/push/vapid-private"], WithDecryption: true });
  });

  it("logs parameters that do not exist and leaves them unset", async () => {
    ssm.on(GetParametersCommand).resolves({ Parameters: [], InvalidParameters: ["/dd/push/expo"] });
    const log = vi.fn();
    const s = await loadPushSecrets({ EXPO_ACCESS_TOKEN_PARAM: "/dd/push/expo" }, client(), log);
    expect(s).toEqual({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining("/dd/push/expo"));
  });

  it("logs and returns nothing when SSM itself fails, never throwing", async () => {
    ssm.on(GetParametersCommand).rejects(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
    const log = vi.fn();
    const s = await loadPushSecrets({ EXPO_ACCESS_TOKEN_PARAM: "/dd/push/expo" }, client(), log);
    expect(s).toEqual({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining("AccessDeniedException"));
  });
});
