/** Local review preparation only; does not create/push a branch or tag, or publish. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { prepareSwiftTagPlan } from './swift-tag-plan.mjs';
const release = resolve(process.argv[2] ?? 'release');
const output = resolve(process.argv[3] ?? 'scripts/generated/swift-tag-plan.json');
const plan = prepareSwiftTagPlan(process.cwd(), release);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(plan, null, 2) + '\n');
console.log(`Prepared unapproved Swift tag commit ${plan.targetCommit}; no refs or remotes changed. Plan: ${output}`);
