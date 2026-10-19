// CocoaPods side of the notices generator: the pods in ios/Podfile.lock and
// the license text CocoaPods collected for each one in its acknowledgements
// plist. Both files exist only after `pod install`, which needs macOS, so
// the iOS CI job produces them; they cannot be read on a Linux machine.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { npmPackageInPath } from "./notices-core.mts";
import type { NativeResult } from "./notices-maven.mts";
import { blocks, decodeXml } from "./notices-xml.mts";

const unquote = (s: string): string => s.trim().replace(/^"(.*)"$/, "$1");

export type PodfileLock = {
  // Root pod name -> version, in file order. Subspecs fold into their root.
  pods: Map<string, string>;
  // Root pod name -> its :path, for pods built from a local folder.
  paths: Map<string, string>;
};

export function parsePodfileLock(text: string): PodfileLock {
  const lock: PodfileLock = { pods: new Map(), paths: new Map() };
  let section = "";
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const top = /^([A-Z][A-Z ]*):/.exec(line);
    if (top) {
      section = top[1];
      continue;
    }
    if (section === "PODS") {
      const pod = /^ {2}- (.+?):?$/.exec(line);
      if (!pod) continue;
      const m = /^(.+) \(([^)]+)\)$/.exec(unquote(pod[1]));
      if (m && !lock.pods.has(m[1].split("/")[0])) lock.pods.set(m[1].split("/")[0], m[2]);
    } else if (section === "EXTERNAL SOURCES") {
      const name = /^ {2}([^ ].*):$/.exec(line);
      if (name) current = unquote(name[1]);
      const path = /^ {4}:path: (.+)$/.exec(line);
      if (path && current) lock.paths.set(current, unquote(path[1]));
    }
  }
  return lock;
}

export type Acknowledgement = { license?: string; text: string };

// Title -> license type and text, from Pods-<target>-acknowledgements.plist.
// CocoaPods leaves out a pod when it finds no license text for it.
export function parseAcknowledgements(xml: string): Map<string, Acknowledgement> {
  const acks = new Map<string, Acknowledgement>();
  const list = /<key>PreferenceSpecifiers<\/key>\s*<array>([\s\S]*)<\/array>/.exec(xml)?.[1] ?? "";
  for (const dict of blocks(list, "dict")) {
    const fields: Record<string, string> = {};
    for (const m of dict.matchAll(/<key>([^<]*)<\/key>\s*(?:<string>([\s\S]*?)<\/string>|<string\/>)/g)) {
      fields[m[1]] = decodeXml(m[2] ?? "");
    }
    const title = fields.Title?.trim();
    if (!title || title === "Acknowledgements" || !fields.FooterText?.trim()) continue;
    acks.set(title, { license: fields.License?.trim() || undefined, text: fields.FooterText });
  }
  return acks;
}

// The two pod install outputs in app/ios, unless the caller names them:
// ios/Podfile.lock and the one Pods-<target>-acknowledgements.plist.
export function podInputs(iosDir: string, lock?: string, acks?: string): { lock: string; acks: string } {
  const lockFile = lock ?? join(iosDir, "Podfile.lock");
  if (!existsSync(lockFile)) throw new Error(`no ${lockFile}; run npx expo prebuild --platform ios (it runs pod install) on macOS first`);
  if (acks) return { lock: lockFile, acks };
  const support = join(iosDir, "Pods", "Target Support Files");
  const found = existsSync(support)
    ? readdirSync(support)
        .filter((d) => d.startsWith("Pods-") && existsSync(join(support, d, `${d}-acknowledgements.plist`)))
        .map((d) => join(support, d, `${d}-acknowledgements.plist`))
    : [];
  if (found.length !== 1) {
    throw new Error(`expected one Pods-*-acknowledgements.plist under ${support}, found ${found.length}; pass --pods-acknowledgements`);
  }
  return { lock: lockFile, acks: found[0] };
}

export function podCandidates(lockFile: string, ackFile: string): NativeResult {
  const lock = parsePodfileLock(readFileSync(lockFile, "utf8"));
  const acks = parseAcknowledgements(readFileSync(ackFile, "utf8"));
  const result: NativeResult = { candidates: [], covered: [], problems: [] };
  if (!lock.pods.size) result.problems.push(`cocoapods: no pods found in the Podfile.lock`);
  for (const [name, version] of lock.pods) {
    const path = lock.paths.get(name);
    const npm = path && npmPackageInPath(path);
    if (npm) {
      result.covered.push({ source: "cocoapods", name, version, npm });
      continue;
    }
    const ack = acks.get(name);
    result.candidates.push({
      source: "cocoapods",
      name,
      version,
      license: ack?.license,
      text: ack?.text ?? "",
      note: ack ? undefined : "CocoaPods found no license text for this pod.",
    });
  }
  return result;
}
