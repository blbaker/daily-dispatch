// Shared parts of the notices generator: the package record every source
// produces, the rules that decide whether a package passes, and the text
// rendering of THIRD_PARTY_NOTICES-<target>.txt.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Source = "npm" | "maven" | "cocoapods";

// One third-party package as a source reports it, before any rule runs.
export type Candidate = {
  source: Source;
  name: string;
  version: string;
  // SPDX id or expression, or the license name a POM or podspec gives.
  license?: string;
  // The package's own license text; empty when it ships none.
  text: string;
  // Printed under the license line, e.g. where the license id came from.
  note?: string;
};

// A native module that is part of an npm package (built from its folder),
// so the npm entry's license covers it.
export type Covered = { source: Source; name: string; version: string; npm: string };

// The npm package a path points into: ".../node_modules/@a/b/ios" -> "@a/b".
export function npmPackageInPath(path: string): string | undefined {
  const parts = path.split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0 || !parts[at + 1]) return undefined;
  return parts[at + 1].startsWith("@") ? `${parts[at + 1]}/${parts[at + 2] ?? ""}` : parts[at + 1];
}

// A package that passed, as it is printed.
export type Notice = Candidate & { license: string; allowReason?: string; standard?: string[] };

// An allowlist entry: a package that may pass without a license id or text,
// for the given targets, because a person checked it and wrote down why.
// textFiles (relative to the allowlist file) replace the package's own text.
export type AllowEntry = {
  source: Source;
  name: string;
  version: string;
  targets: string[];
  reason: string;
  license?: string;
  textFiles?: string[];
};

const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function loadAllowlist(file: string, knownTargets: string[]): { entries: AllowEntry[]; problems: string[] } {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { packages?: unknown };
  const problems: string[] = [];
  const entries: AllowEntry[] = [];
  if (!Array.isArray(raw.packages)) return { entries, problems: [`${file}: needs a "packages" array`] };
  raw.packages.forEach((e: Partial<AllowEntry>, i) => {
    const where = `allowlist entry ${i} (${e.name ?? "no name"})`;
    const bad: string[] = [];
    if (!SOURCE_ORDER.includes(e.source as Source)) bad.push(`source must be one of ${SOURCE_ORDER.join(", ")}`);
    for (const key of ["name", "version", "reason"] as const) if (!isText(e[key])) bad.push(`${key} is required`);
    if (!Array.isArray(e.targets) || !e.targets.length || !e.targets.every((t) => knownTargets.includes(t))) {
      bad.push(`targets must list some of ${knownTargets.join(", ")}`);
    }
    if (e.license !== undefined && !isText(e.license)) bad.push("license must be a non-empty string");
    if (e.textFiles !== undefined && (!Array.isArray(e.textFiles) || !e.textFiles.every(isText))) bad.push("textFiles must be a list of file names");
    for (const t of e.textFiles ?? []) if (!existsSync(join(dirname(file), t))) bad.push(`text file ${t} does not exist`);
    if (bad.length) problems.push(`${where}: ${bad.join("; ")}`);
    else entries.push(e as AllowEntry);
  });
  return { entries, problems };
}

export type Allowlist = { entries: AllowEntry[]; dir: string };

// Line endings, a byte order mark, trailing spaces and blank edges differ by
// platform and checkout; none of them are part of a license.
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export const label = (c: { source: Source; name: string; version: string }): string => `${c.source} ${c.name} ${c.version}`;

export type Resolved = { notices: Notice[]; problems: string[] };

// The SPDX ids in an expression such as "(MIT OR Apache-2.0)" for which a
// standard text exists. OR needs one of them, AND needs all of them.
export function standardFor(expression: string, available: Set<string>): string[] | undefined {
  const ids = expression.replace(/[()]/g, " ").split(/\s+/).filter((t) => t && !/^(OR|AND|WITH)$/.test(t));
  if (/\bAND\b/.test(expression)) return ids.every((id) => available.has(id)) ? ids : undefined;
  const first = ids.find((id) => available.has(id));
  return first ? [first] : undefined;
}

export type Context = { allow: Allowlist; target: string; standard: Set<string> };

// `allow` holds only the entries for the target being generated.
export function resolveCandidates(candidates: Candidate[], { allow, target, standard }: Context): Resolved {
  const notices: Notice[] = [];
  const problems: string[] = [];
  const used = new Set<AllowEntry>();
  for (const c of candidates) {
    const entry = allow.entries.find((e) => e.source === c.source && e.name === c.name && e.version === c.version);
    if (entry) {
      used.add(entry);
      const text = entry.textFiles
        ? entry.textFiles.map((t) => normalizeText(readFileSync(join(allow.dir, t), "utf8"))).join("\n\n")
        : c.text;
      // The entry's reason explains the text it supplies, so drop the source's note.
      const note = entry.textFiles ? undefined : c.note;
      notices.push({ ...c, license: entry.license ?? c.license ?? "not stated", text, note, allowReason: entry.reason });
    } else if (!c.license) problems.push(`${label(c)}: no license declared`);
    else if (c.text) notices.push({ ...c, license: c.license });
    else {
      const ids = standardFor(c.license, standard);
      if (ids) notices.push({ ...c, license: c.license, standard: ids });
      else problems.push(`${label(c)}: no license text found, and no standard text for "${c.license}"`);
    }
  }
  for (const e of allow.entries) {
    if (!used.has(e)) problems.push(`allowlist entry ${label(e)} for ${target} matched no package; update or remove it`);
  }
  return { notices, problems };
}

const RULE = "=".repeat(80);

export type RenderInput = {
  title: string;
  sources: string[];
  notices: Notice[];
  covered: Covered[];
  standardDir: string;
  spdxVersion: string;
};

export function render(input: RenderInput): string {
  const notices = [...input.notices].sort(compareNotices);
  const out: string[] = [
    `Third-party notices: ${input.title}`,
    "",
    "This file lists the third-party software in this build and the license of",
    "each package. scripts/ci/generate-notices.mts writes it; do not edit it.",
    "The npm list is every production dependency in the lockfile, so it also",
    "names build tools (Metro, Babel, the Expo CLI) that do not ship in the app.",
    "",
    "Sources:",
    ...input.sources.map((s) => `  ${s}`),
  ];
  for (const n of notices) {
    out.push("", RULE, `${n.source}: ${n.name} ${n.version}`, `License: ${n.license}`);
    if (n.allowReason) out.push(`Allowlisted: ${n.allowReason}`);
    if (n.note) out.push(n.note);
    if (n.standard) {
      const which = n.standard.join(" and ");
      out.push(`Its license text${n.standard.length > 1 ? "s are" : " is"} the standard ${which} text${n.standard.length > 1 ? "s" : ""} under "Standard license texts" at the end of this file.`);
    } else out.push("", n.text || "No license text is included.");
  }
  if (input.covered.length) {
    out.push("", RULE, "Native modules built from the npm packages above", "");
    out.push("Each of these comes from inside an npm package listed above, built from its", "folder or shipped prebuilt in it, and carries that package's license:", "");
    for (const c of [...input.covered].sort(compareNotices)) out.push(`  ${label(c)}, part of npm ${c.npm}`);
  }
  const used = [...new Set(notices.flatMap((n) => n.standard ?? []))].sort();
  if (used.length) {
    out.push(
      "",
      RULE,
      "Standard license texts",
      "",
      `These are the standard texts from the SPDX License List (version ${input.spdxVersion}),`,
      "without the template copyright line. They apply to the packages above that",
      "point here; each of those entries names its copyright holder when the",
      "package states one.",
    );
    for (const id of used) {
      out.push("", id, "-".repeat(id.length), "", normalizeText(readFileSync(join(input.standardDir, `${id}.txt`), "utf8")));
    }
  }
  return `${out.join("\n")}\n`;
}

const SOURCE_ORDER: Source[] = ["npm", "maven", "cocoapods"];

function compareNotices(a: Candidate | Covered, b: Candidate | Covered): number {
  return (
    SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)
  );
}
