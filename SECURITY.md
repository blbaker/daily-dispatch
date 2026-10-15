# Security Policy

## Reporting a vulnerability

If you find a security issue in this repo (the app, the backend, or the
pipeline scripts), please do not open a public issue. Instead, use GitHub's
private vulnerability reporting: go to the repo's **Security** tab ->
**Report a vulnerability**. That opens a private advisory visible only to
the maintainers until it's resolved.

If private reporting isn't available for some reason, open an issue that
says only "security issue, please contact me privately" with no
details, and a maintainer will follow up.

## What's in scope

- The RN app (`app/`) and how it handles the API key and backend data.
- The backend (`backend/`): the Lambda handler, the API key check, the S3
  release bucket's access controls.
- The pipeline scripts (`pipeline/`): anything that could leak a captured
  link, a secret, or let an attacker inject something into a digest or
  podcast script.

## What's out of scope

- The maintainer's own deployed AWS account, API keys, or ElevenLabs
  account. Those are personal infrastructure run from this code, not part
  of the repo.
- Vulnerabilities in third-party dependencies that already have a public
  CVE and a fix available -- please just open a PR bumping the version, or
  a regular issue if you can't.

## A note on secrets

This repo should never contain a real API key, access token, or account
id. If you spot one in the git history or a file, please report it the
same way as above so it can be rotated, even if it looks like it might
already be invalid.
