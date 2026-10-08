#!/usr/bin/env python3
"""Bind an own-app device receipt to this launch nonce and signed proof build."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--receipt', required=True)
parser.add_argument('--proof-id', required=True)
parser.add_argument('--build-json', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
receipt_bytes = Path(args.receipt).read_bytes()
receipt = json.loads(receipt_bytes)
build = json.loads(Path(args.build_json).read_text())
if receipt.get('proofID') != args.proof_id:
    raise SystemExit('Receipt nonce does not match this launch; refusing stale evidence')
if build.get('signed') is not True or build.get('simulatorOnly') or not build.get('built') or not build.get('binarySha256') or not build.get('nativeBinarySha256'):
    raise SystemExit('A successful signed proof build receipt is required')
if build.get('bundleIdentifier') != 'com.chocopie.runtimeproof':
    raise SystemExit('Unexpected application identity')
fixture = build.get('fixture', {})
if receipt.get('fixtureSha256') != fixture.get('sha256') or receipt.get('fixtureBytes') != fixture.get('bytes') or receipt.get('fixture') != fixture.get('name'):
    raise SystemExit('Receipt fixture does not match the bundled proof workload')
if receipt.get('passed') is not True:
    raise SystemExit('Device proof reported failure: ' + str(receipt.get('error')))
output = Path(args.output)
if output.exists():
    raise SystemExit('Evidence output already exists; preserve previous receipts')
evidence = {
    'executionVerified': True,
    'sdkSource': build['sdkSource'],
    'sdkZipSha256': build['sdkZipSha256'],
    'appBinarySha256': build['binarySha256'],
    'nativeBinarySha256': build['nativeBinarySha256'],
    'verificationSources': build['verificationSources'],
    'receiptSha256': hashlib.sha256(receipt_bytes).hexdigest(),
    'receipt': receipt,
    'scope': 'Autorun SDK checks and bounded metrics only. Physical identity and installation of this exact signed binary must be recorded by the operator; no real background/foreground or energy certification.',
}
output.write_text(json.dumps(evidence, indent=2) + '\n')
print(output)
