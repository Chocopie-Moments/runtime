/** Compare device presentation against existing native/WASM engines; never builds or drives a device. */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyPixels} from '../../packages/runtime/src/pixels.ts';
const evidence=resolve(process.argv[2] ?? 'scripts/generated/android-execution-native');
const asset=resolve(process.argv[3] ?? 'fixtures/ambient.breathe.choco');
const binary=resolve(process.env.CHOCO_NATIVE_FRAMES ?? 'native/choco-native/target/release/frames');
const web=resolve(process.env.CHOCO_WEB_BUILD ?? 'scripts/generated/choco-web');
const output=resolve(process.argv[4] ?? `${evidence}/parity`);
mkdirSync(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=readFileSync(asset), expected=readFileSync(`${evidence}/choco-fixture.sha256`,'utf8').trim();
if(hash(bytes)!==expected) throw new Error('Device fixture SHA256 differs from local canonical fixture');
const width=256,height=256;
const trace=[{op:'resize',width,height},{op:'pause',paused:true},{op:'seek',seconds:0}];
writeFileSync(`${output}/trace.json`,JSON.stringify(trace,null,2)+'\n');
execFileSync(binary,[`${output}/native`,`${output}/trace.json`],{input:bytes});
const native=readFileSync(`${output}/native/2.rgba`);
const {default:initialize}=await import(pathToFileURL(`${web}/choco.mjs`).href);
const core=await initialize();const error=core._malloc(512),status=core._malloc(24),input=core._malloc(bytes.length);
core.HEAPU8.set(bytes,input);
const failure=()=>new TextDecoder().decode(core.HEAPU8.subarray(error,error+512)).split('\0')[0];
const player=core._choco_player_create(input,bytes.length,width,height,false,error,512);core._free(input);
let wasm;
try {
 if(!player) throw new Error(failure());
 if(!core._choco_player_pause(player,true,error,512)||!core._choco_player_seek(player,0,error,512)) throw new Error(failure());
 const pointer=core._choco_web_frame(player,0,width,height,status,error,512);if(!pointer)throw new Error(failure());
 wasm=core.HEAPU8.slice(pointer,pointer+width*height*4);
} finally { if(player)core._choco_player_destroy(player);core._free(error);core._free(status); }
const straight=source=>{const result=new Uint8ClampedArray(source.length);copyPixels(source,result);return result;};
const nativeStraight=straight(native),wasmStraight=straight(wasm);
writeFileSync(`${output}/wasm.premultiplied.rgba`,wasm);
writeFileSync(`${output}/native.straight.rgba`,nativeStraight);
writeFileSync(`${output}/wasm.straight.rgba`,wasmStraight);
const capture=JSON.parse(readFileSync(`${evidence}/choco-android-frame.json`,'utf8'));
if(capture.width!==width||capture.height!==height||capture.seconds!==0||capture.channelLayout!=='RGBA'||capture.alphaMode!=='premultiplied'||capture.byteOrder!=='little'||!Number.isInteger(capture.rowBytes)||capture.rowBytes<width*4) throw new Error('Unexpected direct Android bitmap capture layout or time');
const androidStorage=readFileSync(`${evidence}/choco-android-frame.premultiplied.rgba`);
if(androidStorage.length!==capture.byteCount||androidStorage.length!==capture.rowBytes*height) throw new Error('Direct Android bitmap capture size differs');
// AndroidBitmap RGBA_8888 was filled by JNI memcpy. copyPixelsToBuffer preserves
// those bytes; remove row padding without channel changes or alpha round trips.
const androidPremultiplied=new Uint8Array(width*height*4);
for(let y=0;y<height;y++) androidPremultiplied.set(androidStorage.subarray(y*capture.rowBytes,y*capture.rowBytes+width*4),y*width*4);
const androidCanonicalStraight=straight(androidPremultiplied);
writeFileSync(`${output}/android.canonical-straight.rgba`,androidCanonicalStraight);
const android=readFileSync(`${evidence}/choco-android-frame.rgba`);
const png=execFileSync('python3',['-c','from PIL import Image; import sys; image=Image.open(sys.argv[1]); assert image.size==(256,256); sys.stdout.buffer.write(image.convert("RGBA").tobytes())',`${evidence}/choco-android-frame.png`],{maxBuffer:1048576});
function compare(a,b) {
 if(a.length!==width*height*4||b.length!==a.length) throw new Error('Frame dimensions differ');
 let differingChannels=0,differingPixels=0,maxChannelDifference=0,alphaDifferingPixels=0,opaqueRgbDifferingChannels=0,transparentRgbDifferingChannels=0;
 for(let i=0;i<a.length;i+=4) {let different=false;if(a[i+3]!==b[i+3])alphaDifferingPixels++;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){differingChannels++;different=true;if(c<3&&a[i+3]===255&&b[i+3]===255)opaqueRgbDifferingChannels++;if(c<3&&a[i+3]===0&&b[i+3]===0)transparentRgbDifferingChannels++;}maxChannelDifference=Math.max(maxChannelDifference,delta);}if(different)differingPixels++;}
 return {identical:differingChannels===0,differingChannels,differingPixels,maxChannelDifference,alphaDifferingPixels,opaqueRgbDifferingChannels,transparentRgbDifferingChannels,leftSha256:hash(a),rightSha256:hash(b)};
}
const comparisons={nativeVsWasmPremultiplied:compare(native,wasm),androidVsWasmPremultiplied:compare(androidPremultiplied,wasm),androidVsNativePremultiplied:compare(androidPremultiplied,native),nativeVsWasmStraight:compare(nativeStraight,wasmStraight),androidCanonicalVsWasmStraight:compare(androidCanonicalStraight,wasmStraight),androidRgbaVsWasmStraight:compare(android,wasmStraight),androidPngVsWasmStraight:compare(png,wasmStraight),androidPngVsAndroidRgba:compare(png,android)};
const coreIdentical=['nativeVsWasmPremultiplied','androidVsWasmPremultiplied','androidVsNativePremultiplied','nativeVsWasmStraight','androidCanonicalVsWasmStraight'].every(key=>comparisons[key].identical);
const presentation=['androidRgbaVsWasmStraight','androidPngVsWasmStraight','androidPngVsAndroidRgba'];
const hostRoundtripBounded=presentation.every(key=>comparisons[key].maxChannelDifference<=1&&comparisons[key].alphaDifferingPixels===0&&comparisons[key].opaqueRgbDifferingChannels===0&&comparisons[key].transparentRgbDifferingChannels===0);
const device=JSON.parse(readFileSync(`${evidence}/result.json`,'utf8'));
if(device.status!=='passed') throw new Error('Android Activity verification did not pass');
const report={asset,fixtureSha256:hash(bytes),width,height,seconds:0,paused:true,reducedMotion:false,device,capture,nativeBinarySha256:hash(readFileSync(binary)),wasmBinarySha256:hash(readFileSync(`${web}/choco.wasm`)),androidPngSha256:hash(readFileSync(`${evidence}/choco-android-frame.png`)),comparisons,coreIdentical,hostRoundtripBounded,hostRoundtripBound:'At most one RGB channel value at partially transparent pixels; alpha and fully opaque RGB must match exactly',identical:Object.values(comparisons).every(value=>value.identical),passed:coreIdentical&&hostRoundtripBounded,scope:'One synthetic ambient.breathe frame at seek 0. Direct Android bitmap storage proves core pixels; Android getPixels and PNG codecs are reported separately. Emulator evidence, not physical-device or full-corpus certification'};
writeFileSync(`${output}/comparison.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
