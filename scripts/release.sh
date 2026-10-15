#!/usr/bin/env bash
# release.sh "<release notes>"  [--no-bump]
# Bumps versionCode, builds the e-ink (Boox) and phone APKs, verifies them,
# and publishes them as the latest in-app update (S3 + optional LAN mirror).
# Installed apps see a yellow "update available" banner on next open.
#
# This script is meant to be run by hand, by whoever maintains the deployed
# backend. It is never run in CI. It expects:
#   - ANDROID_HOME / JAVA_HOME already exported (point them at your own
#     Android SDK + JDK; this script does not install a toolchain)
#   - AWS credentials already available (env vars, `aws configure`, or an
#     assumed role -- anything boto3's default credential chain picks up)
#   - RELEASE_BUCKET set to your own S3 bucket (see publish_release.py)
set -euo pipefail
NOTES="${1:-Bug fixes and improvements.}"
BUMP=1; [[ "${2:-}" == "--no-bump" ]] && BUMP=0

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../app" && pwd)"
cd "$APP"

if [[ -z "${ANDROID_HOME:-}" || -z "${JAVA_HOME:-}" ]]; then
  echo "ANDROID_HOME and JAVA_HOME must be set before running this script." >&2
  exit 1
fi

VC=$(python3 -c "import json;print(json.load(open('app.json'))['expo']['android']['versionCode'] + $BUMP)")
VN="1.0.$VC"
python3 - "$VC" "$VN" <<'PY'
import json, sys
p = "app.json"; d = json.load(open(p))
d["expo"]["android"]["versionCode"] = int(sys.argv[1]); d["expo"]["version"] = sys.argv[2]
open(p, "w").write(json.dumps(d, indent=2) + "\n")
PY
sed -i -E "s/versionCode [0-9]+/versionCode $VC/; s/versionName \"[^\"]+\"/versionName \"$VN\"/" android/app/build.gradle
echo "== release v$VC ($VN)"

OUT="${APK_OUT_DIR:-$HOME/daily-dispatch-apks}/$VC"; mkdir -p "$OUT"
trap 'sed -i "s/^EXPO_PUBLIC_EINK=.*/EXPO_PUBLIC_EINK=false/" "$APP/.env"' EXIT
AAPT=$(ls "$ANDROID_HOME"/build-tools/*/aapt2 | tail -1)

build() {  # $1 variant  $2 eink-flag
  sed -i "s/^EXPO_PUBLIC_EINK=.*/EXPO_PUBLIC_EINK=$2/" .env
  local log="/tmp/release-$1.log"
  ( cd android
    ./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks --no-daemon
    ./gradlew assembleRelease --no-daemon ) > "$log" 2>&1 || { echo "BUILD FAILED ($1): $log"; tail -20 "$log"; exit 1; }
  cp android/app/build/outputs/apk/release/app-release.apk "$OUT/daily-dispatch-$1.apk"
  local got; got=$("$AAPT" dump badging "$OUT/daily-dispatch-$1.apk" | grep -oP "versionCode='\K[0-9]+")
  [[ "$got" == "$VC" ]] || { echo "versionCode mismatch in $1 APK: $got != $VC"; exit 1; }
  echo "   built $1: $(du -m "$OUT/daily-dispatch-$1.apk" | cut -f1) MB, versionCode $got"
}
build eink true
build phone false

if [[ "${PUBLISH:-1}" != "1" ]]; then echo "== built v$VC (PUBLISH=0, not published)"; exit 0; fi
python3 "$(dirname "${BASH_SOURCE[0]}")/publish_release.py" "$VC" "$VN" "$NOTES"
echo "== published v$VC"
