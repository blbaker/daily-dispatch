# Third-party notices data

Files read by `scripts/ci/generate-notices.mts`, which writes the
`THIRD_PARTY_NOTICES-<target>.txt` file attached to each release artifact.
[docs/builds.md](../../../docs/builds.md#third-party-notices) explains how
the generator decides what goes in a notices file.

| File | What it is |
|------|------------|
| `allowlist.json` | Packages that pass by a person's decision, each with a reason |
| `licenses/<id>.txt` | Standard license texts, by SPDX id |
| `android-poms.init.gradle` | Gradle init script that lists the Android app's Maven modules and their POMs |
| `impeller-LICENSE.txt` | The LICENSE of react-native-impeller-platform at tag v0.1.0 |
| `impeller-engine.txt` | The components inside the Impeller engine binaries, with upstream license texts |
| `bolts-android-1.4.0.txt` | LICENSE and PATENTS of Bolts-Android 1.4.0, whose POM gives no usable license |

## Allowlist entries

```json
{
  "source": "maven",
  "name": "com.parse.bolts:bolts-tasks",
  "version": "1.4.0",
  "targets": ["android"],
  "license": "BSD-3-Clause",
  "reason": "Why this package may pass, in a sentence a reviewer can check.",
  "textFiles": ["bolts-android-1.4.0.txt"]
}
```

- `source` is `npm`, `maven` or `cocoapods`. `name` is the npm name,
  `group:artifact` for Maven, or the root pod name.
- `version` must match exactly, so a version bump fails the run until someone
  checks the new version and updates the entry.
- `targets` lists the notices files the entry applies to. An entry that
  matches no package for one of its targets fails that target's run.
- `reason` is required and is printed in the notices file.
- `license` (optional) replaces the license id the package declares.
- `textFiles` (optional) are files in this folder that replace the package's
  own license text. Without them, the package's own text is used, or "No
  license text is included." when it has none.

## Standard license texts

`licenses/` holds texts from the SPDX License List
([spdx/license-list-data](https://github.com/spdx/license-list-data),
version 3.29.0), without the template copyright line. The generator uses one
when a package declares an SPDX id but ships no license file, and for Maven
modules, whose POMs only name their license. Add a file here when a new id
needs one, and update `SPDX_VERSION` in the generator if you take it from a
newer release.
