import fs from 'node:fs';

const zdPath = 'src/nodes/ZDefocusNode.js';
const testPath = 'scratch/test_race_condition.mjs';

let zdCode = fs.readFileSync(zdPath, 'utf8');
const testCode = fs.readFileSync(testPath, 'utf8');

const testWorkerMatch = testCode.match(/const WORKER_CODE_FIXED = `([\s\S]*?)`;/);
if (!testWorkerMatch) {
  console.error('Could not find WORKER_CODE_FIXED in test_race_condition.mjs');
  process.exit(1);
}

const fixedWorkerCode = testWorkerMatch[1].trim();

// Replace ZDEFOCUS_WORKER_CODE in ZDefocusNode.js
const regex = /const ZDEFOCUS_WORKER_CODE = `[\s\S]*?`;/;
if (!regex.test(zdCode)) {
  console.error('Could not match ZDEFOCUS_WORKER_CODE in ZDefocusNode.js');
  process.exit(1);
}

zdCode = zdCode.replace(regex, `const ZDEFOCUS_WORKER_CODE = \`\n${fixedWorkerCode}\n\`;`);

fs.writeFileSync(zdPath, zdCode, 'utf8');
console.log('Successfully replaced ZDEFOCUS_WORKER_CODE in', zdPath);

