"use strict";
// Service worker for Web Push. public/sw.js is built from sw/sw.ts with
// `npm run build:sw`, so edit the .ts file. test/notifications/sw.test.ts
// fails when the two drift apart, and runs the built file against a fake
// worker scope.
//
// push: show the notification (browsers require one per push) and tell any
// open window, so the app can refresh its list.
// notificationclick: focus an open window and tell it what to open, or open
// a new window at ?edition=<id> or ?episode=<id>.
const sw = self;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const API_PATH = /^\/(editions|episodes)\/([A-Za-z0-9_-]{1,64})$/;
// Same rules as targetFromData and targetToQuery in src/notifications/target.ts.
function queryFor(data) {
    if (!data)
        return "";
    if ((data.type === "edition" || data.type === "episode") && typeof data.id === "string" && SAFE_ID.test(data.id)) {
        return `?${data.type}=${encodeURIComponent(data.id)}`;
    }
    const m = typeof data.path === "string" ? API_PATH.exec(data.path) : null;
    if (!m)
        return "";
    return `?${m[1] === "editions" ? "edition" : "episode"}=${encodeURIComponent(m[2])}`;
}
function readPayload(event) {
    if (!event.data)
        return {};
    try {
        return event.data.json();
    }
    catch {
        return { body: event.data.text() };
    }
}
async function windows() {
    return (await sw.clients.matchAll({ type: "window", includeUncontrolled: true }));
}
sw.addEventListener("install", () => {
    void sw.skipWaiting();
});
sw.addEventListener("activate", (event) => {
    event.waitUntil(sw.clients.claim());
});
sw.addEventListener("push", (event) => {
    const p = readPayload(event);
    const data = p.data ?? {};
    const tag = data.type && data.id ? `${data.type}-${data.id}` : undefined;
    event.waitUntil((async () => {
        await sw.registration.showNotification(p.title || "Daily Dispatch", { body: p.body ?? "", data, tag });
        for (const w of await windows())
            w.postMessage({ type: "dd-push", data });
    })());
});
sw.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = (event.notification.data ?? null);
    event.waitUntil((async () => {
        const open = (await windows()).find((w) => w.url.startsWith(sw.registration.scope));
        if (open) {
            await open.focus();
            open.postMessage({ type: "dd-open", data });
            return;
        }
        await sw.clients.openWindow(sw.registration.scope + queryFor(data));
    })());
});
