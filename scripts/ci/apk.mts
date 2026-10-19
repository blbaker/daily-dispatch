// Checks for the Android APKs that CI builds. Pure functions only, so the
// tests can feed them synthetic zips and apksigner output.
//
// An APK is a zip file. Its central directory already records each entry's
// CRC-32, which is all these checks need, so nothing is decompressed.

export type ZipEntry = { name: string; crc32: number; size: number };
export type Signing = "debug" | "release";
export type ApkFacts = { variant: string; file: string; entries: Map<string, ZipEntry>; signers: string[] };

export const BUNDLE_ENTRY = "assets/index.android.bundle";

// Debug builds are signed with a certificate whose common name is "Android
// Debug": the Android SDK's own debug keystore and the one the React Native
// and Expo templates ship both use it. The template key is public, so it must
// never sign a release.
const DEBUG_CN = /(?:^|,\s*)CN=Android Debug\s*(?:,|$)/;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

export function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  // The end-of-central-directory record is 22 bytes plus a comment of up to
  // 65535 bytes, so it starts somewhere in that window at the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  if (count === 0xffff) throw new Error("zip64 archives are not supported");
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error(`corrupt central directory at byte ${p}`);
    }
    const nameLength = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    entries.set(name, { name, crc32: buf.readUInt32LE(p + 16), size: buf.readUInt32LE(p + 24) });
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

// Certificate DNs from `apksigner verify --print-certs`, once each. Up to
// build-tools 36 a line reads "Signer #1 certificate DN: ..."; build-tools 37
// names the scheme instead ("V2 Signer: certificate DN: ...") and repeats a
// signer for each scheme it signed.
export function signerDns(apksignerOutput: string): string[] {
  const dns = [...apksignerOutput.matchAll(/^(?:V[\d.]+ )?Signer(?: #\d+)?:? certificate DN: (.+)$/gm)].map((m) => m[1].trim());
  return [...new Set(dns)];
}

export function isDebugCertificate(dn: string): boolean {
  return DEBUG_CN.test(dn);
}

export function apkFileName(variant: string, signing: Signing): string {
  return `daily-dispatch-android-${variant}${signing === "debug" ? "-debug-signed" : ""}.apk`;
}

// Returns one line per problem; an empty list means every APK passed.
export function checkApks(apks: ApkFacts[], signing: Signing): string[] {
  const problems: string[] = [];
  if (apks.length < 2) problems.push(`expected the phone and e-ink APKs, got ${apks.length}`);
  for (const apk of apks) {
    const bundle = apk.entries.get(BUNDLE_ENTRY);
    if (!bundle || bundle.size === 0) {
      problems.push(`${apk.variant}: no ${BUNDLE_ENTRY}, so the APK needs a dev server to start`);
    }
    if (apk.signers.length === 0) problems.push(`${apk.variant}: apksigner reported no signer`);
    for (const dn of apk.signers) {
      if (signing === "release" && isDebugCertificate(dn)) {
        problems.push(`${apk.variant}: signed with the public debug certificate, expected the release keystore`);
      }
      if (signing === "debug" && !isDebugCertificate(dn)) {
        problems.push(`${apk.variant}: expected the debug certificate, got "${dn}"`);
      }
    }
  }
  // EXPO_PUBLIC_EINK is inlined when the JS bundle is built. If both APKs
  // carry the same bundle, the flag never reached one of them.
  const seen = new Map<number, string>();
  for (const apk of apks) {
    const crc = apk.entries.get(BUNDLE_ENTRY)?.crc32;
    if (crc === undefined) continue;
    const other = seen.get(crc);
    if (other) problems.push(`${other} and ${apk.variant} carry the same JS bundle; EXPO_PUBLIC_EINK did not reach it`);
    seen.set(crc, apk.variant);
  }
  return problems;
}
