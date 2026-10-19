// Types for the untyped JS storage module that react-native-impeller-platform
// ships (src/storage/index.js).
declare module "react-native-impeller-platform/src/storage" {
  const storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    getAllKeys(): Promise<string[]>;
    clear(): Promise<void>;
    multiGet(keys: string[]): Promise<[string, string | null][]>;
    multiSet(pairs: [string, string][]): Promise<void>;
  };
  export default storage;
}
