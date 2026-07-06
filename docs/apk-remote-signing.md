# APK Remote Signing Design

This note describes the planned remote signing flow for `.apk` release artifacts
and APK repository indexes. The goal is to keep the private signing key outside
GitHub Actions.

## Goals

- GitHub Actions builds packages and repository indexes, but never stores the
  APK private key.
- A signing server receives only the bytes that must be signed, or their
  canonical digest, and returns the signature.
- CI assembles the final signed `.apk` / `APKINDEX.tar.gz` artifacts locally.
- The same signing key can be trusted by users through a published public key.

## Non-Goals

- The signer does not build packages.
- The signer does not upload GitHub releases.
- The signer does not receive package repository credentials.
- The first version does not need HSM/KMS integration, but the API should allow
  moving the private key there later.

## Signing Model

Use a split flow:

1. CI builds an unsigned `.apk`.
2. CI extracts the apk-tools signing payload.
3. CI sends the payload, or a canonical digest of it, to the signing server.
4. The signing server validates the request and signs with the configured key.
5. CI receives the raw signature and public key name.
6. CI injects the signature block into the `.apk`.
7. CI verifies the signed package with apk-tools before upload.

The same model applies to `APKINDEX.tar.gz`. Repository publishing must sign the
index as well as package files.

## API Sketch

### `POST /v1/sign/apk`

Request:

```json
{
  "key_id": "fleth-2026",
  "algorithm": "rsa-sha256",
  "artifact_name": "luci-app-fleth-0.23-r1.apk",
  "artifact_sha256": "hex sha256 of the unsigned apk",
  "payload_sha256": "hex sha256 of the signing payload",
  "payload": "base64 signing payload"
}
```

Response:

```json
{
  "key_id": "fleth-2026",
  "public_key_name": "fleth-2026.rsa.pub",
  "algorithm": "rsa-sha256",
  "signature": "base64 raw signature"
}
```

### `POST /v1/sign/apkindex`

Use the same shape, with `artifact_name` set to `APKINDEX.tar.gz`.

## CI Responsibilities

- Build the `.apk` package.
- Build `APKINDEX.tar.gz` when publishing an APK repository.
- Extract canonical signing payloads.
- Call the signing server.
- Assemble signed artifacts.
- Verify signatures with the public key.
- Upload only verified signed outputs.

CI should fail closed:

- Missing `APK_SIGNER_URL` in release jobs should fail, not publish unsigned APKs.
- Signer HTTP failures should fail the job.
- Verification failures should fail the job.
- Empty package matches should fail the job.

## Signer Responsibilities

- Keep the APK private key local.
- Authenticate CI requests.
- Validate request metadata.
- Sign only supported algorithms and key IDs.
- Record an audit log:
  - artifact name
  - artifact sha256
  - payload sha256
  - key id
  - caller identity
  - timestamp
- Return only signature material and public key name.

The signer should reject obviously unsafe requests:

- Unknown key ID.
- Unsupported algorithm.
- Missing artifact or payload hashes.
- Payload hash mismatch.
- Re-signing the same artifact version without an explicit override policy.

## Authentication

Recommended order:

1. mTLS between GitHub Actions runner and signer, if practical.
2. Short-lived bearer token stored in GitHub Actions secrets.
3. Source IP allowlist as an additional control, not the only control.

Every request should include an idempotency key, for example:

```text
<github-run-id>/<matrix-target>/<artifact-name>
```

## Public Key Distribution

Publish the signer public key next to the APK repository, for example:

```text
repo/apk/fleth-2026.rsa.pub
repo/apk/APKINDEX.tar.gz
repo/apk/luci-app-fleth-0.23-r1.apk
```

Users then install or trust that public key according to the target OpenWrt APK
workflow.

## Repository Layout

Keep package formats separate:

```text
repo/
  opkg/
    Packages
    Packages.gz
    luci-app-fleth_0.23_all.ipk
    luci-i18n-fleth-*.ipk

  apk/
    fleth-2026.rsa.pub
    APKINDEX.tar.gz
    luci-app-fleth-0.23-r1.apk
    luci-i18n-fleth-*.apk
```

## Open Questions

- Confirm the exact apk-tools payload extraction and signature block format.
- Decide whether CI sends raw signing payload bytes or only the digest.
- Decide how to sign `APKINDEX.tar.gz` with the same remote API.
- Decide whether the signer should enforce version uniqueness.
- Decide public key rotation policy and naming.

## Implementation Plan

1. Create local scripts:
   - `scripts/apk-sign-prepare`
   - `scripts/apk-sign-attach`
   - `scripts/apk-sign-verify`
2. Validate scripts against a known signed APK.
3. Implement the signer endpoint with a local file key.
4. Add CI integration behind `APK_SIGNER_URL` and `APK_SIGNER_TOKEN`.
5. Require signing for tagged release jobs.
6. Add APK repository index signing after package signing works.
