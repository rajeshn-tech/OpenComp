import fs from 'node:fs';

const zdPath = 'src/nodes/ZDefocusNode.js';
const testPath = 'scratch/test_race_condition.mjs';

const testCode = fs.readFileSync(testPath, 'utf8');
const testWorkerMatch = testCode.match(/const WORKER_CODE_FIXED = `([\s\S]*?)`;/);
const fixedWorkerCode = testWorkerMatch[1].trim();

let zdCode = fs.readFileSync(zdPath, 'utf8');
const regex = /const ZDEFOCUS_WORKER_CODE = `[\s\S]*?`;/;

zdCode = zdCode.replace(regex, `const ZDEFOCUS_WORKER_CODE = \`\n${fixedWorkerCode}\n\`;`);

fs.writeFileSync(zdPath, zdCode, 'utf8');

// Immediately read back
const readBack = fs.readFileSync(zdPath, 'utf8');
console.log('Includes Phase 1b in readBack:', readBack.includes('Phase 1b'));

