#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DigestStack } from "../lib/digest-stack";

const app = new cdk.App();
new DigestStack(app, "DailyDigestStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-west-2",
  },
  description: "Daily Digest app backend: DynamoDB + ARM Lambda + Function URL, API-key auth. Single user.",
});
