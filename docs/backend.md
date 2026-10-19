# Backend

The backend is one AWS CDK stack in `backend/`. You need it to sync editions
to the app on several devices, to store podcast episodes, to keep the app's
settings, and to send push notifications. The pipeline, the archive app and
the podcast CLI all work without it.

It is built for one reader. There is one API key, and every request must send
it in the `x-api-key` header.

## What the stack creates

The stack is called `DailyDigestStack`.

- A DynamoDB table, `daily-digest`, billed per request. It holds editions,
  stories, episodes, devices, notifications and settings in one table, with
  one index to list editions and episodes by date.
- A Lambda function, `daily-digest-api`, on Node.js 24 and arm64, behind a
  Lambda Function URL. There is no API Gateway. The URL is public and the
  function checks the API key itself.
- A private S3 bucket for Android app releases, which the in-app updater
  downloads through short-lived presigned URLs.
- A private S3 bucket for podcast episode audio. Publishers upload and apps
  play through presigned URLs.
- An hourly EventBridge rule that checks Expo push receipts and deletes
  devices whose tokens are no longer registered.
- Permission to read four SSM parameters that hold the push credentials. See
  [Push setup](push-setup.md).

The table and both buckets are kept when the stack is deleted, so removing
the stack never deletes your editions or episodes.

## Install and check it locally

None of these commands need AWS credentials.

```sh
cd backend
pnpm install --frozen-lockfile --ignore-workspace
pnpm typecheck
pnpm test
pnpm exec cdk synth --quiet
```

The backend keeps its own lockfile, so it installs with `--ignore-workspace`.
`cdk synth` renders the CloudFormation template with a placeholder API key.

## Deploy

Deploying needs an AWS account and is always done by hand, never by CI.

1. Bootstrap CDK once per account and region, if you have not already:

   ```sh
   pnpm exec cdk bootstrap
   ```

2. Create an API key and keep it somewhere safe, such as a password manager.
   The stack does not print it back.

   ```sh
   openssl rand -hex 32 > api-key
   ```

3. Review the change, then deploy:

   ```sh
   export CDK_DEFAULT_ACCOUNT=<your account id>
   export CDK_DEFAULT_REGION=us-west-2
   pnpm exec cdk diff -c apiKey="$(cat api-key)"
   pnpm exec cdk deploy -c apiKey="$(cat api-key)"
   ```

   Add `-c pushParamPrefix=/your/prefix` to keep the push credentials under
   a different SSM path.

The deploy prints four outputs:

| Output | What it is |
|---|---|
| `ApiUrl` | The Function URL. Drop the trailing slash when you use it. |
| `TableNameOut` | The DynamoDB table name |
| `ReleaseBucketOut` | The app release bucket, for `scripts/release.sh` |
| `MediaBucketOut` | The episode audio bucket |

## Point the clients at it

Each part reads the URL and key from its own variables:

| Part | URL | Key |
|---|---|---|
| App, in `app/.env` | `EXPO_PUBLIC_API_URL` | `EXPO_PUBLIC_API_KEY` |
| Pipeline | `DIGEST_API_URL` | `DIGEST_API_KEY` |
| `daily-dispatch podcast run` | `DAILY_DISPATCH_API_URL` | `DAILY_DISPATCH_API_KEY` |

Expo writes the `EXPO_PUBLIC_*` values into the app bundle when it builds, so
an app or desktop package built for your backend carries your key. Do not
share those builds publicly.

Check the deployment with:

```sh
curl -s "$API/health"
curl -s "$API/editions" -H "x-api-key: $KEY"
```

`/health` is the only route that answers without the key.

## API

| Route | Purpose |
|---|---|
| `GET /health` | Returns `{"ok": true}` |
| `GET /editions` | Editions, newest first |
| `GET /editions/<date>` | One edition with its stories |
| `POST /editions` | Store an edition. The pipeline calls this. A finished edition dated within a day of today sends the new-edition push |
| `POST /episodes` | Store episode metadata and get an upload URL, then publish it |
| `GET /episodes`, `GET /episodes/<id>` | Ready episodes with a presigned audio URL |
| `GET /settings`, `PUT /settings` | Notification switches and the daily podcast settings |
| `POST /devices`, `DELETE /devices/<id>` | Register or remove a push device |
| `POST /devices/<id>/test` | Send one test notification |
| `GET /push/config` | Which push providers are on, and the Web Push public key |
| `GET /notifications/since` | Notifications after a time, for the desktop app |
| `GET /app/latest?variant=phone` | The newest Android release for the in-app updater (`phone` or `eink`) |

[Push setup](push-setup.md) documents the device, settings, notification and
episode routes in full, with request bodies and example `curl` calls.

## Costs

The table bills per request, the function runs on arm64 with 256 MB of
memory, there is no API Gateway, and logs are kept for two weeks. This page
gives no monthly figure because none has been measured for this version of
the stack, so check your AWS billing page after the first month.
