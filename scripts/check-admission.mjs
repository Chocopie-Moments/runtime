import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const cases=JSON.parse(readFileSync('fixtures/admission.json','utf8'));
const output=execFileSync('native/choco-native/target/release/validate',cases.map(x=>x.path),{encoding:'utf8'});
const results=output.trim().split('\n').map(line=>JSON.parse(line));
for(const [i,result] of results.entries()) {
  if(result.path!==cases[i].path || result.accepted!==cases[i].accepted) throw Error('Native admission mismatch: '+result.path);
}
if(results.length!==cases.length) throw Error('Incomplete native admission results');
console.log(`${results.length} native admission cases agree with the codec contract`);
