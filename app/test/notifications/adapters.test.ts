// The native and desktop adapters import react-native and Expo modules, which
// do not load under Node. vi.mock swaps them for small fakes, so the
// adapters' own logic runs here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "./helpers";

const rn = vi.hoisted(() => ({
  os: "android",
  native: null as null | { requestPermission: any; show: any },
  listeners: {} as Record<string, (e: any) => void>,
}));

const expo = vi.hoisted(() => ({
  perm: { granted: false, canAskAgain: true },
  requested: { granted: true, canAskAgain: true },
  token: vi.fn(async () => ({ data: "ExponentPushToken[abc]" })),
  last: null as unknown,
  responseListener: null as null | ((r: any) => void),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return rn.os;
    },
  },
  TurboModuleRegistry: { get: () => rn.native },
  DeviceEventEmitter: {
    addListener: (name: string, fn: (e: any) => void) => {
      rn.listeners[name] = fn;
      return { remove: () => delete rn.listeners[name] };
    },
  },
}));

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "proj-1" } } } } }));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => null),
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: vi.fn(async () => expo.perm),
  requestPermissionsAsync: vi.fn(async () => expo.requested),
  getExpoPushTokenAsync: expo.token,
  addNotificationResponseReceivedListener: (fn: (r: any) => void) => {
    expo.responseListener = fn;
    return { remove: vi.fn() };
  },
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
  getLastNotificationResponseAsync: async () => expo.last,
  clearLastNotificationResponse: vi.fn(),
}));

const { createDesktopAdapter, INSTALL_ID_KEY } = await import("../../src/notifications/desktopAdapter");
const { createNativeAdapter } = await import("../../src/notifications/nativeAdapter");
const Notifications = await import("expo-notifications");

const response = (data: unknown) => ({ notification: { request: { content: { data } } } });

beforeEach(() => {
  rn.native = null;
  rn.listeners = {};
  expo.perm = { granted: false, canAskAgain: true };
  expo.last = null;
});

describe("native adapter (expo-notifications)", () => {
  it("creates the Android channel, then asks only when prompting", async () => {
    const a = createNativeAdapter();
    expect(a.platform).toBe("android");
    expect(await a.permission(false)).toBe("prompt");
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await a.permission(true)).toBe("granted");
  });

  it("reports denied when the OS will not ask again", async () => {
    expo.perm = { granted: false, canAskAgain: false };
    expect(await createNativeAdapter().permission(true)).toBe("denied");
  });

  it("gets an Expo push token for the configured project", async () => {
    expect(await createNativeAdapter().credential()).toEqual({ token: "ExponentPushToken[abc]" });
    expect(expo.token).toHaveBeenCalledWith({ projectId: "proj-1" });
  });

  it("explains a missing push token", async () => {
    expo.token.mockRejectedValueOnce(new Error("Default FirebaseApp is not initialized"));
    await expect(createNativeAdapter().credential()).rejects.toThrow(/No push token: Default FirebaseApp/);
  });

  it("opens the edition or episode for a tap, including the one that launched the app", async () => {
    expo.last = response({ type: "edition", id: "2026-10-19" });
    const open = vi.fn();
    createNativeAdapter().listen!({ open, receive: vi.fn() });
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ kind: "edition", id: "2026-10-19" }));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
    expo.responseListener!(response({ type: "episode", id: "ep-1" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "episode", id: "ep-1" });
  });
});

describe("desktop adapter (Impeller)", () => {
  const note = { id: "n1", event: "edition", title: "Edition", body: "3 stories", data: { type: "edition", id: "2026-10-19" }, createdAt: "t" };

  it("keeps one install id as its poll token", async () => {
    const storage = memoryStore();
    const a = createDesktopAdapter(storage);
    const first = (await a.credential()) as { token: string };
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await a.credential()).toEqual(first);
    expect(storage.data.get(INSTALL_ID_KEY)).toBe(first.token);
  });

  it("returns false from show() without the engine module, so the app banners it", async () => {
    expect(await createDesktopAdapter(memoryStore()).show!(note)).toBe(false);
  });

  it("shows through the engine module and opens the target when it is clicked", async () => {
    rn.native = {
      requestPermission: vi.fn(async () => ({ status: "granted" })),
      show: vi.fn(async () => ({ status: "shown" })),
    };
    const a = createDesktopAdapter(memoryStore());
    expect(await a.permission(true)).toBe("granted");
    expect(rn.native.requestPermission).toHaveBeenCalled();
    expect(await a.show!(note)).toBe(true);
    expect(rn.native.show).toHaveBeenCalledWith("Edition", "3 stories", "dd-n1", JSON.stringify(note.data));
    const open = vi.fn();
    a.listen!({ open, receive: vi.fn() });
    rn.listeners.rniNotificationPress({ id: "dd-n1", action: "default", data: JSON.stringify(note.data) });
    expect(open).toHaveBeenCalledWith({ kind: "edition", id: "2026-10-19" });
  });

  it("returns false when the OS refuses, so the app banners it", async () => {
    rn.native = { requestPermission: vi.fn(), show: vi.fn(async () => ({ status: "denied" })) };
    expect(await createDesktopAdapter(memoryStore()).show!(note)).toBe(false);
  });
});
