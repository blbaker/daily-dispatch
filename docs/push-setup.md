# Push notification setup

The backend sends two kinds of notification: a new edition is published, and
a new podcast episode is ready. Each platform gets them a different way.

| Platform | Delivery | Credentials you create |
|---|---|---|
| Android (phone and e-ink) | Expo push service, then Firebase Cloud Messaging | Firebase project, FCM v1 service account key, Expo access token |
| iOS | Expo push service, then Apple Push Notification service | APNs key (.p8), Expo access token |
| Web | Web Push, signed with VAPID | VAPID key pair and a contact address |
| macOS, Linux, Windows | The app polls `GET /notifications/since` | None |

Nothing breaks while a credential is missing. The provider that needs it stays
off, the Lambda logs one line saying why, and everything else keeps working.
`GET /push/config` shows what is on.

## Where each value goes

The FCM and APNs credentials never reach this backend. They go to Expo, which
talks to Google and Apple for you. The backend only holds the Expo access
token and the VAPID keys, as SSM parameters it reads by name.

| Value | Where it goes |
|---|---|
| FCM v1 service account key (JSON) | Expo project credentials (`eas credentials` or expo.dev) |
| `google-services.json` | The app: `app/google-services.json`, referenced by `android.googleServicesFile` in `app/app.json` |
| APNs key (.p8), its key id, your team id | Expo project credentials (`eas credentials` or expo.dev) |
| Expo access token | SSM SecureString `/daily-dispatch/push/expo-access-token` |
| VAPID public key | SSM String `/daily-dispatch/push/vapid-public-key` |
| VAPID private key | SSM SecureString `/daily-dispatch/push/vapid-private-key` |
| VAPID subject (`mailto:you@example.com`) | SSM String `/daily-dispatch/push/vapid-subject` |

To keep the parameters somewhere else, deploy with
`cdk deploy -c pushParamPrefix=/your/prefix` and use that prefix instead of
`/daily-dispatch/push`. The stack grants the function `ssm:GetParameters` on
those four names and nothing else.

The function re-reads the parameters every 15 minutes, so a new or rotated
value takes effect without a deploy.

For a local run you can skip SSM and set `EXPO_ACCESS_TOKEN`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in the environment.
A value set directly wins over the parameter.

## Expo access token

The Expo push service delivers to iOS and Android. The backend requires an
access token and refuses to run the expo provider without one, because with
Expo's enhanced push security turned on, only a holder of the token can send
to your app's devices.

1. Create the app's project on expo.dev if it does not have one, and note the
   project id. The app needs it to ask for a push token.
2. Open expo.dev, then Account settings, then Access tokens. Create a token
   for this backend.
3. On the same page, turn on enhanced security for push notifications. From
   then on Expo rejects any push request without the token.
4. Store the token:

   ```sh
   aws ssm put-parameter --type SecureString \
     --name /daily-dispatch/push/expo-access-token --value "file://expo-token.txt"
   ```

   Reading the value from a file keeps it out of your shell history. Delete
   the file afterwards.

## Android: Firebase and the FCM v1 key

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project (or reuse one) and add an Android app with the app's package name
   from `app/app.json`.
2. Download `google-services.json` and save it as `app/google-services.json`.
   Point `android.googleServicesFile` in `app/app.json` at it. Google treats
   the file as public identifiers, but it is specific to your Firebase
   project, so keep it out of a public fork.
3. In the Firebase console, open Project settings, then Service accounts, and
   click Generate new private key. This JSON file is a real secret. Never
   commit it.
4. Upload it to Expo. Either run `eas credentials`, pick Android, the
   production profile, Google Service Account, then the FCM V1 push key, and
   upload the file; or on expo.dev open the project's Credentials page, pick
   the Android application identifier, and add it under FCM V1 service
   account key.
5. Rebuild the Android app (phone and e-ink) so it includes
   `google-services.json`. Builds without it never get a push token.

## iOS: APNs key

This needs a paid Apple Developer Program membership.

1. In Certificates, Identifiers & Profiles on developer.apple.com, make sure
   the app's bundle id has the Push Notifications capability.
2. Under Keys, create a key with Apple Push Notifications service (APNs)
   enabled. Download the `.p8` file (Apple lets you download it once) and
   note the key id and your team id.
3. Upload it to Expo with `eas credentials`, pick iOS and the push key
   option, then either upload the `.p8` with its key id or let EAS create a
   key with your Apple account.
4. Rebuild and install the iOS app. Expo asks for a physical device when
   testing push, so test on a phone rather than the simulator.

## Web: VAPID keys

Generate a key pair locally. Nothing is sent anywhere.

```sh
cd backend
pnpm exec web-push generate-vapid-keys --json > vapid.json
```

Store the three values:

```sh
aws ssm put-parameter --type String --name /daily-dispatch/push/vapid-public-key \
  --value "$(node -p 'require("./vapid.json").publicKey')"
aws ssm put-parameter --type SecureString --name /daily-dispatch/push/vapid-private-key \
  --value "$(node -p 'require("./vapid.json").privateKey')"
aws ssm put-parameter --type String --name /daily-dispatch/push/vapid-subject \
  --value "mailto:you@example.com"
```

Then delete `vapid.json`. Push services use the subject to contact you if
your pushes cause trouble; an `https:` URL also works.

Web clients get the public key from `GET /push/config`, so it is configured
once, on the server. Changing the key pair invalidates every existing browser
subscription; browsers have to subscribe again.

## Testing one device

Set these in your shell first. `API` is the stack's `ApiUrl` output without a
trailing slash, `KEY` is the API key you deployed with.

```sh
export API=https://<your-function-url-host>
export KEY=<your api key>
```

1. Check which providers are on:

   ```sh
   curl -s "$API/push/config" -H "x-api-key: $KEY"
   ```

   `"enabled": false` for a provider you set up means its credentials are
   missing or invalid. The function's CloudWatch log has a line starting with
   `push:` that says which.

2. Register the device. The app does this itself once its notification code
   is in. To do it by hand, take the Expo push token the app logs (it looks
   like `ExponentPushToken[...]`):

   ```sh
   curl -s -X POST "$API/devices" -H "x-api-key: $KEY" -H "content-type: application/json" \
     -d '{"platform":"android","kind":"expo","token":"ExponentPushToken[...]"}'
   ```

   For a browser, use `{"platform":"web","kind":"webpush","subscription":<sub>}`
   where `<sub>` is `JSON.stringify(await registration.pushManager.getSubscription())`
   from the page's console. The reply contains the device `id`.

3. Send it a test notification:

   ```sh
   curl -s -X POST "$API/devices/<id>/test" -H "x-api-key: $KEY"
   ```

   | Reply | Meaning |
   |---|---|
   | `"sent": 1` | Handed to Expo or the browser's push service. It should show on the device within seconds. |
   | `"skipped": 1` | The provider is off. Go back to step 1. |
   | `"pruned": 1` | The push service says the token or subscription is dead, and the device was deleted. Reinstall or re-subscribe, then register again. |
   | `"failed": 1` | Anything else. The CloudWatch log has the error. |

4. For Android and iOS, `"sent": 1` only means Expo accepted the message.
   About 15 minutes later Expo has a receipt saying whether FCM or APNs took
   it. The hourly receipt check reads those and deletes devices that came back
   as `DeviceNotRegistered`. A wrong FCM or APNs credential shows up there as
   an error in the log, not in the reply above.

A desktop app registers with `"kind":"poll"` and a stable install id as its
`token`, then polls:

```sh
curl -s "$API/notifications/since?ts=2026-10-19T00:00:00Z&device=<id>" -H "x-api-key: $KEY"
```

Send the returned `cursor` as `ts` on the next poll.

## API reference

All routes need the API key in the `x-api-key` header.

| Route | Purpose |
|---|---|
| `POST /devices` | Register or update a device. Body: `platform` (`ios`, `android`, `web`, `desktop`), `kind` (`expo`, `webpush`, `poll`), `token` or `subscription`, optional `prefs` and `name`. Registering the same token again updates the same row. |
| `DELETE /devices/<id>` | Unregister. Returns `removed: false` if it was already gone. |
| `POST /devices/<id>/test` | Send one test notification to one device. |
| `GET /push/config` | Which providers are on, and the VAPID public key. |
| `GET /settings` | Notification prefs and daily podcast settings. |
| `PUT /settings` | Partial update of either section. A bad value returns 400 naming the field. |
| `GET /notifications/since?ts=` | Notifications after `ts` (ISO time or epoch ms), oldest first. Optional `device` filters by that device's prefs; optional `limit` (1-100, default 50). |
| `POST /episodes` | Store episode metadata and get a presigned upload URL. Post again with `{"id": ..., "ready": true}` after the upload to publish and notify. |
| `GET /episodes`, `GET /episodes/<id>` | Ready episodes with a presigned audio URL. |

Settings shape, with the defaults:

```json
{
  "notifications": { "enabled": true, "newEdition": true, "newEpisode": true },
  "podcast": {
    "enabled": false,
    "time": "06:00",
    "timezone": "UTC",
    "voiceProvider": "elevenlabs",
    "scriptWriter": "command",
    "hostVoices": {}
  },
  "updatedAt": null
}
```

`notifications.enabled` silences everything. A device's own `prefs` have the
same three switches, and both must allow an event before it is sent.
`podcast.time` is `HH:MM` in `podcast.timezone`; the daily episode job reads
these.

A push message carries `title`, `body` and `data`. `data.type` is `edition`
or `episode` (or `test`), `data.id` is the edition date or episode id, and
`data.path` is the API path to load it, for example `/editions/2026-10-19`.
Web Push delivers the same object as the JSON payload of the push event.

Publishing an episode from a script:

```sh
# 1. metadata -> upload URL
curl -s -X POST "$API/episodes" -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"id":"2026-10-19","title":"Monday edition","durationSec":900}' > ep.json
# 2. upload the audio
curl -s -X PUT --upload-file episode.mp3 -H "content-type: audio/mpeg" \
  "$(node -p 'require("./ep.json").upload.url')"
# 3. publish and notify
curl -s -X POST "$API/episodes" -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"id":"2026-10-19","ready":true}'
```

Step 3 returns 409 if the audio is not in the bucket yet. Each edition and
episode notifies once, however many times it is posted, and only editions
dated within a day of today notify, so re-pushing the whole archive stays
quiet.
