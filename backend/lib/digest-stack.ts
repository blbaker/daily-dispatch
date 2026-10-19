import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
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
 */
export class DigestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Single-table design.
    //   Edition item:  PK = "EDITION#<date>"      SK = "META"
    //   Story item:    PK = "EDITION#<date>"      SK = "STORY#<nn>"
    // Query one edition = one partition read. List editions = GSI on type.
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

    // The handler is TypeScript under lambda/, bundled by esbuild at synth
    // time. The AWS SDK v3 ships with the Node.js runtime, so it stays out of
    // the bundle; everything else (web-push) is bundled in.
    const backendRoot = path.join(__dirname, "..");
    const fn = new nodejs.NodejsFunction(this, "DigestApi", {
      functionName: "daily-digest-api",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64, // Graviton — cheapest
      entry: path.join(backendRoot, "lambda", "handler.ts"),
      handler: "handler",
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, "pnpm-lock.yaml"),
      bundling: { externalModules: ["@aws-sdk/*"] },
      memorySize: 256, // small; JSON assembly only
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        API_KEY: apiKey,
        GSI_NAME: "byType",
        RELEASE_BUCKET: releases.bucketName,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    table.grantReadWriteData(fn);
    releases.grantRead(fn); // presigned GETs are signed with the function's role

    // Function URL — free, no API Gateway. Auth is the in-function API key,
    // so the URL itself is NONE (public endpoint, key-gated in code).
    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ["content-type", "x-api-key"],
      },
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: url.url });
    new cdk.CfnOutput(this, "TableNameOut", { value: table.tableName });
    new cdk.CfnOutput(this, "ReleaseBucketOut", { value: releases.bucketName });
  }
}
