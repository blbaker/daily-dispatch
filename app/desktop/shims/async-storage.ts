// AsyncStorage for the desktop build.
//
// The phone build uses @react-native-async-storage/async-storage, whose native
// half does not exist on the Impeller engine. The engine ships an AppStorage
// module (one small file per key) and react-native-impeller-platform wraps it
// in an AsyncStorage-shaped API. This module exposes that API under the
// AsyncStorage default export the app imports, so src/api.ts runs unchanged.
//
// Where the files live: the engine's per-user app data directory, or the
// directory in RNI_STORAGE_DIR when that is set (the desktop gate uses it to
// keep test runs out of the real cache).
import storage from "react-native-impeller-platform/src/storage";

type Pair = [string, string | null];

const AsyncStorage = {
  getItem: (key: string): Promise<string | null> => storage.getItem(key),
  setItem: (key: string, value: string): Promise<void> => storage.setItem(key, value),
  removeItem: (key: string): Promise<void> => storage.removeItem(key),
  getAllKeys: (): Promise<string[]> => storage.getAllKeys(),
  clear: (): Promise<void> => storage.clear(),
  multiGet: (keys: readonly string[]): Promise<Pair[]> => storage.multiGet([...keys]),
  multiSet: (pairs: ReadonlyArray<[string, string]>): Promise<void> => storage.multiSet([...pairs]),
  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) await storage.removeItem(key);
  },
};

export default AsyncStorage;
