#!/usr/bin/env python3
"""Exercise the installed Release app with the exact T3-returned agent-device flags.

Requires Pillow. Example: python3 scripts/choco/verify-rn-consumer.py --app <id>
  --agent-device <T3 executable> --platform ios --udid <T3 udid>
  --config <T3 config> --session <T3 session>
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument('--app', default='io.chocopie.RNConsumerVerification')
parser.add_argument('--agent-device', required=True)
parser.add_argument('--profile', choices=['rn', 'expo', 'android', 'android-minified', 'android-expo'], default='rn')
args, flags = parser.parse_known_args()
android = '--platform' in flags and flags[flags.index('--platform') + 1] == 'android'
assert all(name in flags for name in ['--platform', '--serial' if android else '--udid', '--config', '--session']), 'Pass every exact T3 device flag'
output = pathlib.Path(f'scripts/generated/{args.profile}-execution')
output.mkdir(parents=True, exist_ok=True)
checks = []

def command(*parts):
    return subprocess.check_output([args.agent_device, *parts, *flags], text=True, stderr=subprocess.STDOUT)

def snapshot():
    data = json.loads(command('snapshot', '-i', '--json'))
    assert data['success'], data
    return data['data']['nodes']

def wait_for(text):
    if android: text = text.removeprefix('Playback status: ')
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        nodes = snapshot()
        if any(text.casefold() in node.get('label', '').casefold() for node in nodes): return nodes
        time.sleep(0.1)
    raise AssertionError(f'Missing UI text: {text}')

def click(label):
    nodes = snapshot()
    def matches(nodes):
        return [node for node in nodes if node.get('label', '').casefold() == label.casefold() and node['type'] in ['Button', 'android.widget.Button']]
    found = matches(nodes)
    if android and not found:
        command('scroll', 'bottom')
        found = matches(snapshot())
    if android and not found:
        command('scroll', 'top')
        found = matches(snapshot())
    assert len(found) == 1, f'Missing/ambiguous visible button: {label}'
    command('click', '@' + found[0]['ref'])

def capture(name, expected_frame=None):
    # Accessibility layout may stay unchanged during compositor overscroll/bounce.
    # Require both geometry and three exact paused-frame crops to settle.
    if android and expected_frame is None: command('scroll', 'top')
    labels = ['Controlled moment', 'Independent paused moment']
    def geometry(nodes):
        return (nodes[0]['rect'], {label: next(node['rect'] for node in nodes if node.get('label') == label) for label in labels})
    deadline = time.monotonic() + 12
    previous = None
    stable = 0
    attempt = 0
    while time.monotonic() < deadline:
        time.sleep(0.2)
        before = snapshot()
        shape = geometry(before)
        attempt += 1
        target = output / f'{name}.attempt-{attempt}.png'
        command('screenshot', str(target.resolve()))
        after = snapshot()
        (output / f'{name}.attempt-{attempt}.json').write_text(json.dumps({'before': before, 'after': after}, indent=2) + '\n')
        if shape != geometry(after):
            assert expected_frame is None, 'Paused capture geometry changed'
            previous = None
            stable = 0
            continue
        image = Image.open(target).convert('RGB')
        scale = 1 if android else image.width / before[0]['rect']['width']
        regions = {}
        for label, rect in shape[1].items():
            box = tuple(round(value * scale) for value in [rect['x'], rect['y'], rect['x'] + rect['width'], rect['y'] + rect['height']])
            assert 0 <= box[0] < box[2] <= image.width and 0 <= box[1] < box[3] <= image.height, f'Player outside screenshot: {label}'
            regions[label] = image.crop(box)
        if expected_frame is not None:
            assert ImageChops.difference(expected_frame['Controlled moment'], regions['Controlled moment']).getbbox() is None, 'Paused player advanced during strict sampling'
        same = previous is not None and previous[0] == shape and all(
            ImageChops.difference(previous[1][label], regions[label]).getbbox() is None for label in labels)
        stable = stable + 1 if same else 1
        previous = (shape, regions)
        if stable >= 3:
            (output / f'{name}.png').write_bytes(target.read_bytes())
            (output / f'{name}.json').write_text(json.dumps(after, indent=2) + '\n')
            return regions
    raise AssertionError(f'Capture did not settle within 12 seconds: {name}; attempt evidence retained')

def changed(before, after, label):
    return ImageChops.difference(before[label], after[label]).getbbox() is not None

command('close', args.app)
command('open', args.app)
wait_for('Playback status: Loaded bundled .choco')
wait_for('loads: 1')
checks.append('Release app loads bundled .choco through Fabric without Metro')
click('Pause')
wait_for('Resume')
baseline = capture('paused-idle')
click('State active')
click('Seek 0.5 seconds')
active = capture('paused-active-seek')
assert changed(baseline, active, 'Controlled moment'), 'Native state/seek commands did not change presented pixels'
assert not changed(baseline, active, 'Independent paused moment'), 'One view mutated another player'
checks.append('State and seek change actual pixels while preserving an independent player')
time.sleep(0.25)
stable = capture('paused-stable', expected_frame=active)
assert not changed(active, stable, 'Controlled moment'), 'Paused player advanced'
checks.append('Paused player presents stable pixels')
click('Change palette')
palette = capture('palette')
assert changed(active, palette, 'Controlled moment'), 'Palette command did not reach native rendering'
assert not changed(active, palette, 'Independent paused moment'), 'Palette leaked between players'
checks.append('Palette command updates only its own native surface')
click('Click trigger')
click('Look right')
click('Release gaze')
click('Source strokes')
wait_for('loads: 2')
wait_for('Playback status: Loaded bundled .choco')
checks.append('Source replacement loads a new bundled asset')
command('scroll', 'bottom')
click('Invalid state')
command('scroll', 'top')
wait_for('Playback status: Error:')
checks.append('Invalid state reports a native error through Fabric')
command('scroll', 'bottom')
click('Unmount moment')
wait_for('Mount moment')
click('Mount moment')
command('scroll', 'top')
# The remounted player initially has an invalid state; fix it through props.
click('State idle')
click('Source pulse')
wait_for('loads: 3')
wait_for('Playback status: Loaded bundled .choco')
checks.append('Unmount/remount and valid source replacement recover after an error')
command('home')
command('open', args.app)
wait_for('Playback status: Loaded bundled .choco')
capture('foregrounded')
checks.append('Actual OS Home/foreground preserves the loaded player')
receipt = pathlib.Path(f'scripts/generated/choco-{args.profile}-consumer.json')
record = json.loads(receipt.read_text()) if receipt.exists() else {}
record.update(executionVerified=True, physicalDeviceVerified=False, executionApp=args.app, checks=checks,
              evidence={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in output.glob('*')})
receipt.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'verified': True, 'checks': checks}, indent=2), flush=True)
