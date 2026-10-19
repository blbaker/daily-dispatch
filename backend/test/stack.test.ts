import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { DigestStack } from "../lib/digest-stack";

const template = (() => {
  const app = new cdk.App();
  const stack = new DigestStack(app, "DailyDigestStack", { env: { account: "123456789012", region: "us-west-2" } });
  return Template.fromStack(stack);
})();

const PARAMS = {
  EXPO_ACCESS_TOKEN_PARAM: "/daily-dispatch/push/expo-access-token",
  VAPID_PUBLIC_KEY_PARAM: "/daily-dispatch/push/vapid-public-key",
  VAPID_PRIVATE_KEY_PARAM: "/daily-dispatch/push/vapid-private-key",
  VAPID_SUBJECT_PARAM: "/daily-dispatch/push/vapid-subject",
};

function apiFunction() {
  const fns = template.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "daily-digest-api" } });
  const [logicalId, fn] = Object.entries(fns)[0];
  return { logicalId, props: fn.Properties };
}

describe("DigestStack", () => {
  it("keeps the API function and its URL under the same logical ids, so neither is replaced", () => {
    expect(apiFunction().logicalId).toBe("DigestApiC9D6654C");
    expect(Object.keys(template.findResources("AWS::Lambda::Url"))).toEqual(["DigestApiFunctionUrlEEEE127D"]);
  });

  it("runs on a supported Node.js runtime with room for fan-out", () => {
    expect(apiFunction().props).toMatchObject({ Runtime: "nodejs24.x", Timeout: 30, Architectures: ["arm64"] });
  });

  it("passes SSM parameter names for push credentials, never the values", () => {
    const env = apiFunction().props.Environment.Variables;
    expect(env).toMatchObject({ ...PARAMS, MEDIA_BUCKET: { Ref: expect.stringMatching(/^MediaBucket/) } });
    for (const secret of ["EXPO_ACCESS_TOKEN", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      expect(env).not.toHaveProperty(secret);
    }
  });

  it("lets the function read exactly those parameters", () => {
    const arns = Object.values(PARAMS).map((name) => ({
      "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, `:ssm:us-west-2:123456789012:parameter${name}`]],
    }));
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: "ssm:GetParameters", Effect: "Allow", Resource: arns })]),
      },
    });
  });

  it("adds a private, retained media bucket for episode audio", () => {
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      Properties: {
        BucketName: "daily-dispatch-media-123456789012",
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
        },
      },
    });
  });

  it("checks Expo receipts on an hourly schedule", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 hour)",
      Targets: [Match.objectLike({ Arn: { "Fn::GetAtt": ["DigestApiC9D6654C", "Arn"] } })],
    });
  });

  it("allows PUT and DELETE through the Function URL CORS config", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      Cors: { AllowMethods: Match.arrayWith(["GET", "POST", "PUT", "DELETE"]) },
    });
  });
});
