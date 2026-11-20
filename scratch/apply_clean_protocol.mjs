import fs from 'node:fs';

const zdPath = 'src/nodes/ZDefocusNode.js';
const testPath = 'scratch/test_clean_protocol.mjs';

const testCode = fs.readFileSync(testPath, 'utf8');
const testWorkerMatch = testCode.match(/const CLEAN_WORKER_CODE = `([\s\S]*?)`;/);
const cleanWorkerCode = testWorkerMatch[1].trim();

let zdCode = fs.readFileSync(zdPath, 'utf8');
const regex = /const ZDEFOCUS_WORKER_CODE = `[\s\S]*?`;/;

zdCode = zdCode.replace(regex, `const ZDEFOCUS_WORKER_CODE = \`\n${cleanWorkerCode}\n\`;`);

fs.writeFileSync(zdPath, zdCode, 'utf8');

const readBack = fs.readFileSync(zdPath, 'utf8');
console.log('Includes Consume command immediately:', readBack.includes('Consume command immediately'));

