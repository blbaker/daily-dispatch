#!/usr/bin/env python3
"""Publish built APKs as the latest in-app update.

Uploads $APK_OUT_DIR/<versionCode>/daily-dispatch-{phone,eink}.apk to your
own S3 release bucket, writes releases/latest-<variant>.json (what the
backend's GET /app/latest reads), prunes to the newest KEEP releases, and
optionally mirrors the APKs to a local directory (e.g. a LAN download
folder) if APK_MIRROR_DIR is set.

Required env: RELEASE_BUCKET (the S3 bucket from the CDK stack output).
Run manually by whoever maintains the deployed backend; never run in CI.

Usage: publish_release.py <versionCode> <versionName> "<notes>"
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

import boto3

REGION = os.environ.get("AWS_REGION", "us-west-2")
KEEP = 3


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    bucket = os.environ.get("RELEASE_BUCKET")
    if not bucket:
        print("RELEASE_BUCKET is not set (the S3 bucket name from the CDK "
              "stack's ReleaseBucketOut output)", file=sys.stderr)
        return 1
    vc, vn, notes = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    src = Path(os.environ.get("APK_OUT_DIR", str(Path.home() / "daily-dispatch-apks"))) / str(vc)
    mirror_dir = os.environ.get("APK_MIRROR_DIR")
    mirror_names = {"phone": "daily-dispatch-phone.apk", "eink": "daily-dispatch-boox-eink.apk"}

    s3 = boto3.client("s3", region_name=REGION)
    for variant in ("phone", "eink"):
        apk = src / f"daily-dispatch-{variant}.apk"
        key = f"releases/{vc}/{apk.name}"
        s3.upload_file(str(apk), bucket, key,
                       ExtraArgs={"ContentType": "application/vnd.android.package-archive"})
        manifest = {"versionCode": vc, "versionName": vn, "notes": notes,
                    "size": apk.stat().st_size, "sha256": sha256(apk), "key": key}
        # manifest last, so clients never see a version whose APK isn't uploaded yet
        s3.put_object(Bucket=bucket, Key=f"releases/latest-{variant}.json",
                      Body=json.dumps(manifest).encode(), ContentType="application/json",
                      CacheControl="no-store")
        if mirror_dir:
            shutil.copyfile(apk, Path(mirror_dir) / mirror_names[variant])
        print(f"{variant}: v{vc} {manifest['size']} bytes -> s3://{bucket}/{key}")

    # prune: keep newest KEEP version folders
    resp = s3.list_objects_v2(Bucket=bucket, Prefix="releases/", Delimiter="/")
    vers = sorted(int(p["Prefix"].split("/")[1]) for p in resp.get("CommonPrefixes", [])
                  if p["Prefix"].split("/")[1].isdigit())
    for old in vers[:-KEEP]:
        objs = s3.list_objects_v2(Bucket=bucket, Prefix=f"releases/{old}/").get("Contents", [])
        if objs:
            s3.delete_objects(Bucket=bucket,
                              Delete={"Objects": [{"Key": o["Key"]} for o in objs]})
            print(f"pruned v{old}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
