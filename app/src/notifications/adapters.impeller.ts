// Desktop (Impeller) build: only the poll adapter exists here. See adapters.ts
// for why this is a separate file.
import type { PushApi } from "./api";
import { createDesktopAdapter } from "./desktopAdapter";
import type { Channel, KeyValueStore, PushAdapter } from "./types";

export function adapterFactories(_api: PushApi, storage: KeyValueStore): Record<Channel, () => PushAdapter> {
  const unavailable = (channel: Channel) => (): PushAdapter => {
    throw new Error(`push channel "${channel}" is not available in the desktop build`);
  };
  return {
    expo: unavailable("expo"),
    webpush: unavailable("webpush"),
    poll: () => createDesktopAdapter(storage),
  };
}
