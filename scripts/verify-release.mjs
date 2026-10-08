import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const gates=JSON.parse(readFileSync('release-gates.json','utf8'));
if(!gates.ready || gates.blockers.length) throw Error('Release gates remain open; only development artifacts may be built.');
const id=process.env.BUILD_RUN;
if(!/^\d+$/.test(id ?? '')) throw Error('Expected a numeric build run ID');
const run=JSON.parse(execFileSync('gh',['api',`repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${id}`],{encoding:'utf8'}));
if(run.conclusion!=='success' || run.head_sha!==process.env.GITHUB_SHA || run.path!=='.github/workflows/build.yml' || run.event!=='push' || run.head_branch!=='main') throw Error('Use successful main build artifacts from this exact commit.');
