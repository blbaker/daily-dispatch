// Maven side of the notices generator: the external modules on the Android
// app's release runtime classpath, read from the report that
// scripts/ci/notices/android-poms.init.gradle writes, and the POM of each.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Candidate, Covered } from "./notices-core.mts";
import { npmPackageInPath } from "./notices-core.mts";
import { blocks, firstText, stripComments } from "./notices-xml.mts";

// Runs the thirdPartyPoms task from the init script in the generated Android
// project (app/android) and returns the path of the report it wrote.
export function runGradlePoms(androidDir: string, initScript: string): string {
  if (!existsSync(join(androidDir, "app", "build.gradle"))) {
    throw new Error(`no Gradle project at ${androidDir}; run npx expo prebuild --platform android in app/ first`);
  }
  const report = join(mkdtempSync(join(tmpdir(), "notices-poms-")), "poms.tsv");
  const win = process.platform === "win32";
  const args = ["-q", "--no-daemon", "--no-configuration-cache", "-I", initScript, ":app:thirdPartyPoms", `-PnoticesOut=${report}`];
  // stdout only carries the Expo plugin's banner; errors arrive on stderr.
  const r = spawnSync(win ? "gradlew.bat" : "./gradlew", args, { cwd: androidDir, stdio: ["ignore", "ignore", "inherit"], shell: win });
  if (r.status !== 0) throw new Error(`gradlew :app:thirdPartyPoms failed (exit ${r.status})`);
  return report;
}

type PomLicense = { name?: string; url?: string };
type Pom = { licenses: PomLicense[]; parent?: string; holder?: string };

export function readPom(file: string): Pom {
  const xml = stripComments(readFileSync(file, "utf8"));
  const licenses = blocks(blocks(xml, "licenses")[0] ?? "", "license").map((l) => ({ name: firstText(l, "name"), url: firstText(l, "url") }));
  const parentXml = blocks(xml, "parent")[0];
  const parent = parentXml && ["groupId", "artifactId", "version"].map((t) => firstText(parentXml, t) ?? "").join(":");
  const org = blocks(xml, "organization")[0];
  const developer = blocks(xml, "developer")[0];
  const holder = (org && firstText(org, "name")) || (developer && (firstText(developer, "name") || firstText(developer, "organization"))) || undefined;
  return { licenses, parent: parent || undefined, holder };
}

// POMs name licenses in free text. Map the spellings seen on Maven Central
// and Google's repository to SPDX ids; anything else is kept as written, so
// it fails later unless it happens to be an SPDX id with a standard text.
export function spdxForPom({ name = "", url = "" }: PomLicense): string {
  const n = name.trim();
  if (/apache/i.test(n) && /\b2(\.0)?\b/.test(n)) return "Apache-2.0";
  if (!n && /apache\.org\/licenses\/LICENSE-2\.0/i.test(url)) return "Apache-2.0";
  if (/^(the )?mit( license)?$/i.test(n)) return "MIT";
  return n || url;
}

type Row = { role: string; coord: string; pom?: string };

function readReport(file: string): Row[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [role, coord, pom] = l.split("\t");
      return { role, coord, pom: pom && pom !== "-" ? pom : undefined };
    });
}

export type NativeResult = { candidates: Candidate[]; covered: Covered[]; problems: string[] };

export function mavenCandidates(reportFile: string): NativeResult {
  const rows = readReport(reportFile);
  const pomOf = new Map(rows.map((r) => [r.coord, r.pom]));
  const result: NativeResult = { candidates: [], covered: [], problems: [] };
  for (const row of rows.filter((r) => r.role === "module")) {
    const [group, artifact, version] = row.coord.split(":");
    const name = `${group}:${artifact}`;
    const npm = row.pom && npmPackageInPath(row.pom);
    if (npm) {
      result.covered.push({ source: "maven", name, version, npm });
      continue;
    }
    if (!row.pom) {
      result.candidates.push({ source: "maven", name, version, text: "", note: "Gradle found no POM for this module." });
      continue;
    }
    // Walk up the parent POMs until one declares a license.
    const own = readPom(row.pom);
    let pom = own;
    for (let depth = 0; !pom.licenses.length && pom.parent && depth < 10; depth++) {
      const file = pomOf.get(pom.parent);
      if (!file) break;
      pom = readPom(file);
    }
    const holder = own.holder ?? pom.holder;
    const named = pom.licenses.map((l) => [l.name, l.url && `(${l.url})`].filter(Boolean).join(" ")).join("; ");
    result.candidates.push({
      source: "maven",
      name,
      version,
      license: pom.licenses.length ? pom.licenses.map(spdxForPom).join(" AND ") : undefined,
      text: "",
      note: pom.licenses.length
        ? `License in the POM: ${named}.${holder ? ` Copyright holder named in the POM: ${holder}.` : ""}`
        : "The POM and its parents declare no license.",
    });
  }
  return result;
}
