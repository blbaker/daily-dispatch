# Push notifications in the app

This is the app side of push. [push-setup.md](push-setup.md) covers the
backend routes and the credentials. The code is in `app/src/notifications`.

## How each platform gets notifications

| Platform | Channel | What the app does |
|---|---|---|
| Android (phone and e-ink), iOS | Expo push (`expo-notifications`) | Creates an Android notification channel, asks for permission, gets an Expo push token, registers it with `POST /devices` |
| Web | Web Push | Registers `public/sw.js`, subscribes with the VAPID key from `GET /push/config`, registers the subscription with `POST /devices` |
| Desktop (Impeller: macOS, Linux, Windows) | Polling | Registers a stable install id as a `poll` device, then reads `GET /notifications/since` every 5 minutes while the app runs |

`Platform.OS` picks the channel: `ios` and `android` use Expo push, `web`
uses Web Push, and anything else (Impeller reports `impeller`) polls.

The app registers on every launch. The backend derives the device id from
the token, so this updates one row rather than adding new ones.

### When the user is asked

- Android and iOS ask on the first launch while notifications are switched on
  in the app. After that the OS remembers the answer.
- The web never asks on page load, because browsers penalise sites that do.
  If permission was already granted, the app subscribes quietly. Otherwise it
  waits for `enableNotifications()`, which the Settings screen calls from a
  click.
- Desktop needs no permission to poll. On macOS the engine's Notifications
  module shows the system prompt once.

### Taps

A notification carries `data.type` (`edition` or `episode`) and `data.id`.

- Edition: the app reloads the list and opens that edition, on the Today tab
  when it is the newest one and under Archive otherwise.
- Episode: the app fetches `GET /episodes/<id>` and opens its audio URL in the
  system player.
- Web: the service worker focuses an open app window and posts it the target.
  With no window open it opens `/?edition=<id>` or `/?episode=<id>`, which the
  app reads once and then removes from the address bar.
- Desktop: a click on an OS notification arrives through the engine's
  `rniNotificationPress` event. When the engine has no Notifications module,
  or the OS refuses, the app shows an in-app strip at the top with Dismiss and
  Open.

A push that arrives while the app is open (native foreground or a web push
with a window open) also refreshes the edition list.

## Settings API

The Settings screen binds to these exports from `app/src/notifications`:

| Export | Use |
|---|---|
| `useNotificationPrefs()` | `{ prefs, setPrefs }` for the three switches: `enabled`, `newEdition`, `newEpisode` |
| `getNotificationPrefs()`, `setNotificationPrefs(patch)`, `subscribeNotificationPrefs(fn)` | The same without React |
| `getNotificationPrefsState()` | Prefs plus `updatedAt` (epoch ms of the last local change) and `dirty` |
| `syncNotificationPrefs()` | Sends a pending change; resolves `true` when the backend has everything |
| `useNotificationStatus()`, `getNotificationStatus()` | `{ channel, state, deviceId?, detail? }`; `state` is `off`, `unsupported`, `needs-permission`, `denied`, `registered` or `error` |
| `enableNotifications()` | Asks for permission and registers. Call it from a tap |

`setNotificationPrefs` saves on the device first, then sends all three
switches to `PUT /settings`. If that fails the change stays marked `dirty`
and is sent on the next launch or when the app comes back to the
foreground. Unknown keys or non-boolean values throw.

## What you need for real delivery

None of these are in the repo. Without them the app still runs, and the
status reports what is missing.

1. An EAS project id. Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `app/.env`, or
   `expo.extra.eas.projectId` in `app/app.json`. Expo push tokens need it.
2. Android: a Firebase project, `app/google-services.json`, and
   `android.googleServicesFile` in `app/app.json`, then the FCM v1 service
   account key uploaded to Expo. See push-setup.md. Without the file the token
   request fails and the status reads `No push token: ...`.
3. iOS: an APNs key uploaded to Expo, and a signed build on a real phone.
4. Web: the VAPID keys in SSM. Until then `GET /push/config` returns a null
   key and the status reads `Web Push is off on the server`.
5. Desktop: nothing.

## Checks

From `app/`:

```sh
npm ci --legacy-peer-deps
npm run typecheck   # app, e2e scripts and the service worker
npm test            # vitest: 71 tests, fetch mocked, no network
```

`public/sw.js` is generated. Edit `sw/sw.ts`, then run `npm run build:sw`.
`npm test` fails if the two drift apart.

The browser run needs a web export pointed at the mock backend in `e2e/`:

```sh
EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 EXPO_PUBLIC_API_KEY=local-test-key \
  npx expo export --platform web --clear --output-dir /tmp/dd-web
npm run e2e:webpush -- /tmp/dd-web /tmp/dd-webpush 8787
```

It launches headless Chromium with notifications allowed and checks that
the app subscribes and registers, that a push delivered through DevTools is
shown by the service worker, and that both tap paths open the edition.
Creating the subscription contacts the browser's push service, so the run
needs internet access.

## What has not been verified

- Delivery from the real push services (FCM, APNs, a browser push service) to
  a device. That needs the credentials above. The web run delivers its push
  through DevTools, not through the push service.
- A real click on an OS notification. The service worker's click handler is
  tested against a fake worker scope, and the app's handling of the two
  messages it produces is tested in Chromium.
- The desktop poller inside an Impeller build. The adapter follows the
  engine module's documented contract; the desktop app itself lands in a
  later change.
- The Android build was a debug build for `arm64-v8a`. It compiles and
  includes `expo-notifications` and its Firebase messaging service, but it
  was not installed on a device.
