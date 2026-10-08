#!/bin/bash
# Private Android-only development package; never publish or advertise iOS support.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/choco-android-proof.XXXXXX")"
python3 - "$repo" "$stage" <<'PY'
import hashlib,json,pathlib,shutil,subprocess,sys
repo,stage=map(pathlib.Path,sys.argv[1:]); source=repo/'packages/react-native'; android=source/'android'
def digest(p): return dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
def contained(root,name):
 p=(root/name).resolve(); assert p.is_relative_to(root.resolve()); return p
receipt=json.loads((android/'src/main/ANDROID-BUILD.json').read_text())
assert receipt['artifacts'] and receipt['notices']
assert receipt['rendererPatches']==json.loads((repo/'native/renderer/patch.json').read_text())
for a in receipt['artifacts']: assert digest(contained(android/'src/main/jniLibs',a['path']))=={k:a[k] for k in ['bytes','sha256']}
assert {a['path'] for a in receipt['artifacts']}=={str(p.relative_to(android/'src/main/jniLibs')) for p in (android/'src/main/jniLibs').glob('*/libchoco.so')}
for name,expected in receipt['sources'].items():
 assert digest(contained(repo,name))['sha256']==expected
 if name.endswith('.kt'): assert digest(android/'src/main/java/com/chocopie'/pathlib.Path(name).name)['sha256']==expected
for name,expected in receipt['notices'].items(): assert digest(contained(android/'src/main',name))==expected
manifest=json.loads((source/'package.json').read_text()); manifest['files']=['src','android','react-native.config.js','LICENSE','NOTICE','third-party','NATIVE-BUILD.json']; manifest['codegenConfig'].pop('ios',None)
(stage/'package.json').write_text(json.dumps(manifest,indent=2)+'\n')
for name in ['src','android','LICENSE','NOTICE']:
 p=source/name
 if p.is_dir(): shutil.copytree(p,stage/name,ignore=shutil.ignore_patterns('build','.gradle','local.properties','node_modules'))
 else: shutil.copyfile(p,stage/name)
shutil.copytree(repo/'third-party',stage/'third-party')
(stage/'react-native.config.js').write_text("module.exports={dependency:{platforms:{ios:null}}};\n")
record=dict(version=1,platforms=['android'],source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),android=receipt,files={str(p.relative_to(stage)):digest(p) for p in stage.rglob('*') if p.is_file()})
(stage/'NATIVE-BUILD.json').write_text(json.dumps(record,indent=2)+'\n')
PY
(cd "$stage" && npm pack --ignore-scripts --json > pack.json)
python3 - "$repo" "$stage" <<'PY'
import pathlib,json,hashlib,sys
repo,stage=map(pathlib.Path,sys.argv[1:]); tarball=stage/json.loads((stage/'pack.json').read_text())[0]['filename']
record=dict(tarball=str(tarball),stage=str(stage),bytes=tarball.stat().st_size,sha256=hashlib.sha256(tarball.read_bytes()).hexdigest(),provenance=json.loads((stage/'NATIVE-BUILD.json').read_text()))
(repo/'scripts/generated').mkdir(exist_ok=True);(repo/'scripts/generated/choco-android-proof-package.json').write_text(json.dumps(record,indent=2)+'\n');print(tarball)
PY
