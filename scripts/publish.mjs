import { prepareSwiftTagPlan, assertReviewedSwiftTag } from './swift-tag-plan.mjs';
import { reviewedReleaseFiles } from './release-files.mjs';
import { assertPublicationDestinationsAvailable } from './publication-collisions.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=resolve(process.argv[2]);
const receipt=JSON.parse(readFileSync(resolve(directory,'artifacts.json'),'utf8'));
if(receipt.source!==process.env.GITHUB_SHA || receipt.dirty || !receipt.releaseGates.ready || receipt.releaseGates.blockers.length) throw Error('Artifacts are not an approved clean release.');
const versions=new Set(Object.values(receipt.packages).map(p=>p.version));
if(receipt.nativePlatforms?.join(',')!=='ios,android' || !receipt.native?.['choco-android-sdk-release.aar']) throw Error('The reviewed release must contain combined iOS/Android React Native and the independent Android SDK.');
if(versions.size!==1) throw Error('Packages must belong to one tested release family');
const version=[...versions][0];
if(!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)) throw Error('Invalid release version');
const { artifacts, attachments } = reviewedReleaseFiles(directory,receipt,version);
for(const artifact of artifacts) {
 const bytes=readFileSync(resolve(directory,artifact.file));
 if(bytes.length!==artifact.bytes || createHash('sha256').update(bytes).digest('hex')!==artifact.sha256) throw Error('Artifact integrity failed: '+artifact.file);
}
const catalog=JSON.parse(readFileSync(resolve(directory,receipt.catalog.file),'utf8'));
if(catalog.source!==receipt.source || catalog.format!==receipt.releaseGates.format || catalog.semantics!==receipt.releaseGates.semantics) throw Error('Catalog source differs from the reviewed artifacts.');
for(const name of ['@chocopie/runtime','@chocopie/react','@chocopie/react-native']) {
 const entry=catalog.packages[name], expected=receipt.packages[name];
 if(!entry || !expected || ['version','file','sha256'].some(key=>entry[key]!==expected[key])) throw Error('Catalog package pin differs: '+name);
}
// Verify every archive before the first external write. npm rejects development private packages.
for(const [name,artifact] of Object.entries(receipt.packages)) {
 const path=resolve(directory,artifact.file);
 const manifest=JSON.parse(execFileSync('tar',['-xOf',path,'package/package.json'],{encoding:'utf8'}));
 if(manifest.name!==name || manifest.private || manifest.version!==version) throw Error('Unpublishable package: '+manifest.name);
}
// Swift tag approval is separate: the remote tag must already point at the exact
// deterministic manifest-only commit whose parent is the reviewed artifact source.
const swiftPlan=prepareSwiftTagPlan(process.cwd(),directory);
let tag;
try { tag=JSON.parse(execFileSync('gh',['api',`repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/v${version}`],{encoding:'utf8'})); }
catch { throw Error('Review the prepared Swift tag plan and approve its remote tag before package publication.'); }
assertReviewedSwiftTag(swiftPlan,tag);
assertPublicationDestinationsAvailable(receipt.packages,process.env.GITHUB_REPOSITORY,`v${version}`);
for(const artifact of Object.values(receipt.packages)) execFileSync('npm',['publish',resolve(directory,artifact.file),'--access','public','--provenance','--tag',version.includes('-')?'next':'latest'],{stdio:'inherit'});
execFileSync('gh',['release','create',`v${version}`,'--verify-tag','--target',swiftPlan.targetCommit,'--title',`Runtime ${version}`,'--generate-notes',...(version.includes('-')?['--prerelease']:[]),...attachments],{stdio:'inherit'});
