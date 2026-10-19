// npm side of the notices generator: the production packages a
// package-lock.json installs, read from the installed node_modules tree.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, type Candidate } from "./notices-core.mts";

type LockEntry = {
  version?: string;
  name?: string;
  dev?: boolean;
  link?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  os?: string[];
  cpu?: string[];
};

// The OS and CPU a desktop build runs on, in npm's terms ("linux", "x64").
export type Platform = { os: string; cpu: string };

// npm's os and cpu fields: allowed values, or "!value" to exclude one.
function allows(list: string[] | undefined, value: string): boolean {
  if (!list?.length) return true;
  if (list.includes(`!${value}`)) return false;
  const allowed = list.filter((v) => !v.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

// The license id a package.json declares: an SPDX expression in `license`, or
// the older object and array forms. Undefined when it declares none.
export function declaredLicense(manifest: Record<string, unknown>): string | undefined {
  const typeOf = (v: unknown): string | undefined =>
    typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string" ? (v as { type: string }).type : undefined;
  // Some old packages put a plain string in the plural field.
  const single = typeOf(manifest.license) ?? typeOf(manifest.licenses);
  if (single?.trim()) return single.trim();
  if (Array.isArray(manifest.licenses)) {
    const ids = manifest.licenses.map(typeOf).filter((t): t is string => !!t?.trim());
    if (ids.length) return ids.length === 1 ? ids[0] : `(${ids.join(" OR ")})`;
  }
  return undefined;
}

const LICENSE_FILE = /^(licen[cs]e|copying)([.\-_].*)?$/i;

// License files at the top of a package folder, in a stable order.
export function licenseFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => LICENSE_FILE.test(n) && statSync(join(dir, n)).isFile())
    .sort();
}

function packageText(dir: string): string {
  const files = licenseFiles(dir);
  if (files.length === 1) return normalizeText(readFileSync(join(dir, files[0]), "utf8"));
  return files.map((f) => `--- ${f} ---\n\n${normalizeText(readFileSync(join(dir, f), "utf8"))}`).join("\n");
}

// The author field, as "Name" or "Name <email>"; undefined when absent.
function author(manifest: Record<string, unknown>): string | undefined {
  const a = manifest.author;
  if (typeof a === "string" && a.trim()) return a.trim();
  if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
    const { name, email } = a as { name: string; email?: unknown };
    return typeof email === "string" ? `${name} <${email}>` : name;
  }
  return undefined;
}

function missingFileNote(manifest: Record<string, unknown>): string {
  const holder = author(manifest);
  return holder
    ? `The package ships no license file. Copyright holder named by the package: ${holder}.`
    : "The package ships no license file and names no copyright holder.";
}

// "node_modules/a/node_modules/@b/c" -> "@b/c"
function nameFromKey(key: string): string {
  const tail = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  return tail;
}

export type NpmResult = { candidates: Candidate[]; problems: string[] };

// Production packages only: npm marks dev-only ones with "dev". A package
// with os or cpu fields is a native binary for one machine type. For a
// desktop target it counts when it matches that target (the engine package);
// for the phone and web builds it never does, because those are build tools
// such as lightningcss that run on the build machine and ship nowhere.
export function npmCandidates(appDir: string, platform?: Platform): NpmResult {
  const lock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8")) as { packages?: Record<string, LockEntry> };
  const candidates: Candidate[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "" || entry.dev || entry.link || !key.includes("node_modules/")) continue;
    const name = entry.name ?? nameFromKey(key);
    const version = entry.version ?? "";
    const hostSpecific = !!(entry.os?.length || entry.cpu?.length);
    if (hostSpecific && !(platform && allows(entry.os, platform.os) && allows(entry.cpu, platform.cpu))) continue;
    const dir = join(appDir, ...key.split("/"));
    if (!existsSync(join(dir, "package.json"))) {
      if (hostSpecific && platform) {
        const p = `${platform.os}-${platform.cpu}`;
        problems.push(`npm ${name} ${version}: built for ${p} but not installed; generate this target on ${p} after npm ci`);
      } else if (!entry.optional && !entry.devOptional) {
        problems.push(`npm ${name} ${version}: in package-lock.json but not installed; run npm ci first`);
      }
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    if (manifest.version !== version) {
      problems.push(`npm ${name} ${version}: node_modules has version ${String(manifest.version)}; run npm ci first`);
      continue;
    }
    if (seen.has(`${name}@${version}`)) continue;
    seen.add(`${name}@${version}`);
    const text = packageText(dir);
    const candidate: Candidate = { source: "npm", name, version, license: declaredLicense(manifest), text };
    if (!text) candidate.note = missingFileNote(manifest);
    candidates.push(candidate);
  }
  return { candidates, problems };
}
