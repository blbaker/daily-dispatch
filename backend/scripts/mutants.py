#!/usr/bin/env python3
"""Apply one source mutation at a time, run vitest, and report whether the
suite caught it. Restores every file afterwards. Usage: mutants.py"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MUTANTS = [
    ("lambda/push/fanout.ts", "return global.enabled && global[pref] && d.enabled && d[pref];",
     "return global.enabled && global[pref] && d.enabled;", "device event pref ignored"),
    ("lambda/push/fanout.ts", "return global.enabled && global[pref] && d.enabled && d[pref];",
     "return global[pref] && d.enabled && d[pref];", "global master switch ignored"),
    ("lambda/push/fanout.ts", "for (const id of r.invalid) await deleteDevice(deps, id);",
     "", "no pruning"),
    ("lambda/push/fanout.ts", 'const expo = devices.filter((d) => d.kind === "expo");',
     'const expo = devices.filter((d) => d.kind !== "webpush");', "pollers pushed to"),
    ("lambda/routes/editions.ts", "return d >= today - DAY_MS && d <= today + DAY_MS;",
     "return true;", "history re-push notifies"),
    ("lambda/notifications.ts", '`${since.toISOString()}#~`', "since.toISOString()", "cursor row repeated"),
    ("lambda/routes/notifications.ts", "const last = page.items[page.items.length - 1];",
     "const last = notifications[notifications.length - 1];", "cursor stuck on filtered rows"),
    ("lambda/notifications.ts", 'ConditionExpression: "attribute_not_exists(pk)",', "", "duplicate sends"),
    ("lambda/push/expo.ts", 'if (t.details?.error === "DeviceNotRegistered") result.invalid.push(deviceId);',
     "", "expo dead token kept"),
    ("lambda/push/webpush.ts", "if (status === 404 || status === 410) result.invalid.push(devices[i].id);",
     "", "webpush gone subscription kept"),
    ("lambda/presign.ts", 'const canonical = [method, path,', 'const canonical = ["GET", path,',
     "presign ignores the method"),
    ("lambda/routes/episodes.ts", "if (!(await audioUploaded(deps, episode))) {", "if (false) {",
     "episode notifies before the upload"),
    ("lambda/routes/episodes.ts", 'if (!e || e.status !== "ready")', "if (!e)", "uploading episode served"),
    ("lambda/push/receipts.ts", "age(r) >= MIN_AGE_MS && ", "", "receipts asked too early"),
    ("lambda/push/receipts.ts", "for (const id of dead) await deleteDevice(deps, id);", "", "receipt dead token kept"),
    ("lambda/handler.ts", 'isScheduled(event) ? checkExpoReceipts(deps) : http(event)', 'http(event as HttpEvent)',
     "schedule never checks receipts"),
]

def run_suite() -> bool:
    r = subprocess.run(["npx", "vitest", "run"], cwd=ROOT, capture_output=True, text=True)
    return r.returncode == 0

survivors = 0
for rel, old, new, label in MUTANTS:
    path = ROOT / rel
    if not path.exists():
        print(f"SKIP  {label}: {rel} missing")
        continue
    src = path.read_text()
    if old not in src:
        print(f"SKIP  {label}: pattern not found in {rel}")
        survivors += 1
        continue
    path.write_text(src.replace(old, new, 1))
    try:
        passed = run_suite()
    finally:
        path.write_text(src)
    print(f"{'SURVIVED' if passed else 'killed  '}  {label}")
    survivors += passed
sys.exit(1 if survivors else 0)
