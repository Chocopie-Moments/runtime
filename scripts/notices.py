"""Collect notices from the exact locked Rust dependencies before packing native/WASM artifacts."""
import json,pathlib,subprocess,shutil
out=pathlib.Path('third-party/rust');out.mkdir(parents=True,exist_ok=True)
metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--manifest-path','native/choco-native/Cargo.toml'],text=True))
records=[]
for package in metadata['packages']:
    if package['source'] is None: continue
    root=pathlib.Path(package['manifest_path']).parent
    paths=sorted(p for p in root.iterdir() if p.is_file() and p.name.upper().startswith(('LICENSE','COPYING','NOTICE')))
    if not paths: raise RuntimeError('Missing license text: '+package['name'])
    directory=out/(package['name']+'-'+package['version']);directory.mkdir(exist_ok=True)
    for path in paths: shutil.copyfile(path,directory/path.name)
    records.append(dict(name=package['name'],version=package['version'],license=package['license'],source=package['source'],files=[p.name for p in paths]))
(out/'dependencies.json').write_text(json.dumps(records,indent=2)+'\n')
print(f'Collected notices for {len(records)} locked dependencies')
