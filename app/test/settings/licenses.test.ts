// The About section's license list must name every runtime dependency, with
// the license its own package.json declares, so it cannot drift silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LICENSES } from "../../src/settings/licenses";

const root = join(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("licenses", () => {
  it("lists the app itself first, under its own license", () => {
    expect(LICENSES[0]).toEqual({ name: "Daily Dispatch", license: pkg.license });
  });

  it("lists every runtime dependency with the license it ships", () => {
    const listed = new Map(LICENSES.map((l) => [l.name, l.license]));
    for (const dep of Object.keys(pkg.dependencies)) {
      const own = JSON.parse(readFileSync(join(root, "node_modules", dep, "package.json"), "utf8"));
      expect([dep, listed.get(dep)]).toEqual([dep, own.license]);
    }
    expect(LICENSES).toHaveLength(Object.keys(pkg.dependencies).length + 1);
  });
});
