import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from "path";

/**
 * Daily Digest backend — cheapest viable serverless for a SINGLE user.
 *
 * Cost design:
 *  - DynamoDB PAY_PER_REQUEST (on-demand): no idle cost; one user = pennies/$0.
 *  - Lambda on ARM/Graviton: cheapest per-ms, covered by the always-free tier.
 *  - Lambda Function URL instead of API Gateway: removes per-request gateway
 *    charges entirely (API GW REST is ~$3.50/M requests; Function URL is free).
 *  - API key auth done IN the function (constant-time compare) — no Cognito,
 *    no WAF, no gateway authorizer to pay for.
 *  - Logs retention 2 weeks so CloudWatch storage never accumulates.
 *  - Push credentials live in SSM Parameter Store (standard tier, free); the
 *    function gets parameter NAMES only, never values.
 *  - One hourly EventBridge invocation checks Expo delivery receipts
 *    (~720 invocations a month, inside the free tier).
 */
export class DigestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Single-table design.
    //   Edition item:  PK = "EDITION#<date>"      SK = "META"
    //   Story item:    PK = "EDITION#<date>"      SK = "STORY#<nn>"
    //   Episode item:  PK = "EPISODE#<id>"        SK = "META"
    //   Device:        PK = "DEVICE"              SK = <id>
    //   Notification:  PK = "NOTIFICATION"        SK = "<ISO time>#<event>#<ref>"
    //   Settings:      PK = "SETTINGS"            SK = "CURRENT"
    // Query one edition = one partition read. List editions/episodes = GSI on type.
    const table = new dynamodb.Table(this, "DigestTable", {
      tableName: "daily-digest",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never auto-delete Baker's data
      pointInTimeRecovery: false, // extra cost; single user, source is the WSL box
    });

    // GSI to list edition META items newest-first without a scan.
    //   itemType = "EDITION" for every META row; date as the sort key.
    table.addGlobalSecondaryIndex({
      indexName: "byType",
      partitionKey: { name: "itemType", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // The API key lives in a CDK context value at deploy time and is injected as
    // an env var. It is NEVER written to source. Pass at deploy:
    //   cdk deploy -c apiKey=<value>
    // (For diff/synth a placeholder is used so the template renders.)
    const apiKey = this.node.tryGetContext("apiKey") || "PLACEHOLDER_SET_AT_DEPLOY";

    // Private bucket for app releases (in-app updates). Objects are only ever
    // reached through short-lived presigned URLs handed out by the key-gated
    // API. ~55 MB x 2 variants x last 3 releases = pennies/month.
    const releases = new s3.Bucket(this, "ReleaseBucket", {
      bucketName: `daily-dispatch-releases-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Private bucket for podcast episode audio. Publishers upload with a
    // presigned PUT and apps play with a presigned GET, both handed out by
    // the key-gated API. ~15 MB a day, a few cents a month.
    const media = new s3.Bucket(this, "MediaBucket", {
      bucketName: `daily-dispatch-media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Push credentials are SSM parameters under this prefix (see
    // docs/push-setup.md). Missing parameters leave that provider disabled.
    const paramPrefix: string = this.node.tryGetContext("pushParamPrefix") || "/daily-dispatch/push";
    const pushParams = {
      EXPO_ACCESS_TOKEN_PARAM: `${paramPrefix}/expo-access-token`,
      VAPID_PUBLIC_KEY_PARAM: `${paramPrefix}/vapid-public-key`,
      VAPID_PRIVATE_KEY_PARAM: `${paramPrefix}/vapid-private-key`,
      VAPID_SUBJECT_PARAM: `${paramPrefix}/vapid-subject`,
    };

    // The handler is TypeScript under lambda/, bundled by esbuild at synth
    // time. The AWS SDK v3 ships with the Node.js runtime, so it stays out of
    // the bundle; everything else (web-push) is bundled in.
    const backendRoot = path.join(__dirname, "..");
    const fn = new nodejs.NodejsFunction(this, "DigestApi", {
      functionName: "daily-digest-api",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64, // Graviton, cheapest
      entry: path.join(backendRoot, "lambda", "handler.ts"),
      handler: "handler",
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, "pnpm-lock.yaml"),
      bundling: { externalModules: ["@aws-sdk/*"] },
      memorySize: 256, // small; JSON assembly and a few HTTPS calls
      timeout: cdk.Duration.seconds(30), // fan-out waits on Expo and Web Push
      environment: {
        TABLE_NAME: table.tableName,
        API_KEY: apiKey,
        GSI_NAME: "byType",
        RELEASE_BUCKET: releases.bucketName,
        MEDIA_BUCKET: media.bucketName,
        ...pushParams,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    table.grantReadWriteData(fn);
    releases.grantRead(fn); // presigned GETs are signed with the function's role
    media.grantReadWrite(fn, "episodes/*"); // presigned PUT, GET and HEAD
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: Object.values(pushParams).map((name) =>
          this.formatArn({ service: "ssm", resource: "parameter", resourceName: name.replace(/^\//, "") }),
        ),
      }),
    );

    // Hourly Expo receipt check: prunes tokens Expo reports as unregistered.
    new events.Rule(this, "ExpoReceiptCheck", {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn)],
    });

    // Function URL — free, no API Gateway. Auth is the in-function API key,
    // so the URL itself is NONE (public endpoint, key-gated in code).
    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [
          lambda.HttpMethod.GET,
          lambda.HttpMethod.POST,
          lambda.HttpMethod.PUT,
          lambda.HttpMethod.DELETE,
        ],
        allowedHeaders: ["content-type", "x-api-key"],
      },
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: url.url });
    new cdk.CfnOutput(this, "TableNameOut", { value: table.tableName });
    new cdk.CfnOutput(this, "ReleaseBucketOut", { value: releases.bucketName });
    new cdk.CfnOutput(this, "MediaBucketOut", { value: media.bucketName });
  }
}
