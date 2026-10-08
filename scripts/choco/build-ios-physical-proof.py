#!/usr/bin/env python3
"""Prepare/build a dedicated proof app; never installs it or reads phone contents."""
import argparse, hashlib, json, os, pathlib, plistlib, shutil, subprocess, zipfile
os.environ.setdefault("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")
p=argparse.ArgumentParser(); p.add_argument('--zip',required=True); p.add_argument('--sha256',required=True); p.add_argument('--source',required=True); p.add_argument('--team',required=True); p.add_argument('--device',required=True); p.add_argument('--output',required=True); p.add_argument('--build',action='store_true'); p.add_argument('--simulator-id'); a=p.parse_args()
repo=pathlib.Path(__file__).resolve().parents[2]; out=pathlib.Path(a.output).resolve()
if out.exists(): raise SystemExit('Output must be a new directory')
b=pathlib.Path(a.zip).read_bytes()
if hashlib.sha256(b).hexdigest()!=a.sha256: raise SystemExit('SDK ZIP SHA mismatch')
out.mkdir(parents=True)
with zipfile.ZipFile(a.zip) as z:
 for n in z.namelist():
  if pathlib.PurePosixPath(n).is_absolute() or '..' in pathlib.PurePosixPath(n).parts: raise SystemExit('Unsafe ZIP path')
 z.extractall(out/'sdk')
stages=list((out/'sdk').glob('*/Package.swift'))
if len(stages)!=1: raise SystemExit('Expected exactly one Swift package')
stage=stages[0].parent; receipt=json.loads((stage/'build.json').read_text())
if receipt['source']!=a.source: raise SystemExit('SDK source mismatch')
app=out/'App'; app.mkdir(); sources=[]
for name in ['VerificationApp.swift','VerificationChecks.swift','VerificationMetrics.swift']:
 shutil.copyfile(repo/'native/ios'/name,app/name); sources.append(name)
shutil.copyfile(repo/'fixtures/beat.flow.choco',app/'flows.choco')
# A real standalone application project with a local package dependency.
objects={}; counter=0
def obj(isa,**fields):
 global counter
 counter+=1; key=f'{counter:024X}'; objects[key]={'isa':isa,**fields}; return key
refs=[]; builds=[]
for name in sources+['flows.choco']:
 ref=obj('PBXFileReference',path='App/'+name,sourceTree='<group>',lastKnownFileType='sourcecode.swift' if name.endswith('.swift') else 'file')
 refs.append(ref); builds.append(obj('PBXBuildFile',fileRef=ref))
product=obj('PBXFileReference',explicitFileType='wrapper.application',path='ChocoPhysicalProof.app',sourceTree='BUILT_PRODUCTS_DIR')
products=obj('PBXGroup',children=[product],name='Products',sourceTree='<group>')
main=obj('PBXGroup',children=refs+[products],sourceTree='<group>')
package=obj('XCLocalSwiftPackageReference',relativePath=str(stage))
dependency=obj('XCSwiftPackageProductDependency',package=package,productName='Choco')
framework=obj('PBXBuildFile',productRef=dependency)
phases=[obj('PBXSourcesBuildPhase',buildActionMask=2147483647,files=builds[:-1],runOnlyForDeploymentPostprocessing=0),obj('PBXResourcesBuildPhase',buildActionMask=2147483647,files=[builds[-1]],runOnlyForDeploymentPostprocessing=0),obj('PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[framework],runOnlyForDeploymentPostprocessing=0)]
settings={'SDKROOT':'iphonesimulator' if a.simulator_id else 'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'16.0','SWIFT_VERSION':'6.0','PRODUCT_BUNDLE_IDENTIFIER':'com.chocopie.runtimeproof','PRODUCT_NAME':'ChocoPhysicalProof','DEVELOPMENT_TEAM':a.team,'CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','INFOPLIST_KEY_CFBundleDisplayName':'Choco Runtime Proof','INFOPLIST_KEY_UILaunchScreen_Generation':'YES','TARGETED_DEVICE_FAMILY':'1,2','SWIFT_OPTIMIZATION_LEVEL':'-O','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks']}
config=obj('XCBuildConfiguration',buildSettings=settings,name='Release'); configs=obj('XCConfigurationList',buildConfigurations=[config],defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
target=obj('PBXNativeTarget',buildConfigurationList=configs,buildPhases=phases,buildRules=[],dependencies=[],name='ChocoPhysicalProof',packageProductDependencies=[dependency],productName='ChocoPhysicalProof',productReference=product,productType='com.apple.product-type.application')
pc=obj('XCBuildConfiguration',buildSettings={'IPHONEOS_DEPLOYMENT_TARGET':'16.0'},name='Release'); pcl=obj('XCConfigurationList',buildConfigurations=[pc],defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
project=obj('PBXProject',attributes={'LastUpgradeCheck':'2600'},buildConfigurationList=pcl,compatibilityVersion='Xcode 14.0',developmentRegion='en',hasScannedForEncodings=0,knownRegions=['en','Base'],mainGroup=main,productRefGroup=products,projectDirPath='',projectRoot='',targets=[target],packageReferences=[package])
proj=out/'ChocoPhysicalProof.xcodeproj'; proj.mkdir(); (proj/'project.pbxproj').write_bytes(plistlib.dumps({'archiveVersion':'1','classes':{},'objectVersion':'56','objects':objects,'rootObject':project}))
command=['xcrun','xcodebuild','-project',str(proj),'-scheme','ChocoPhysicalProof','-configuration','Release','-destination','id='+(a.simulator_id or a.device),'-derivedDataPath',str(out/'DerivedData'),'-jobs','2'] + (['CODE_SIGNING_ALLOWED=NO'] if a.simulator_id else ['-allowProvisioningUpdates']) + ['build']
metadata={'sdkSource':a.source,'sdkZipSha256':a.sha256,'bundleIdentifier':'com.chocopie.runtimeproof','fixture':{'name':'flows.choco','bytes':(app/'flows.choco').stat().st_size,'sha256':hashlib.sha256((app/'flows.choco').read_bytes()).hexdigest()},'verificationSources':{n:hashlib.sha256((app/n).read_bytes()).hexdigest() for n in sources},'buildCommand':command,'built':False,'signed':not bool(a.simulator_id),'simulatorOnly':bool(a.simulator_id)}
(out/'proof-build.json').write_text(json.dumps(metadata,indent=2)+'\n')
if a.build:
 subprocess.run(command,check=True)
 built=out/('DerivedData/Build/Products/Release-iphonesimulator/ChocoPhysicalProof.app' if a.simulator_id else 'DerivedData/Build/Products/Release-iphoneos/ChocoPhysicalProof.app')
 metadata.update(built=True,app=str(built),binarySha256=hashlib.sha256((built/'ChocoPhysicalProof').read_bytes()).hexdigest(),nativeBinarySha256=hashlib.sha256((built/'Frameworks/ChocoNative.framework/ChocoNative').read_bytes()).hexdigest())
 (out/'proof-build.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(out/'proof-build.json')
