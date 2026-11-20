import fs from 'node:fs';

const zdCode = fs.readFileSync('src/nodes/ZDefocusNode.js', 'utf8');
const testCode = fs.readFileSync('scratch/test_race_condition.mjs', 'utf8');

// Extract ZDEFOCUS_WORKER_CODE from zdCode
const zdWorkerMatch = zdCode.match(/const ZDEFOCUS_WORKER_CODE = `([\s\S]*?)`;/);
const testWorkerMatch = testCode.match(/const WORKER_CODE_FIXED = `([\s\S]*?)`;/);

if (!zdWorkerMatch || !testWorkerMatch) {
  console.log('Could not match worker codes');
  process.exit(1);
}

const zdWorker = zdWorkerMatch[1].trim();
const testWorker = testWorkerMatch[1].trim();

if (zdWorker === testWorker) {
  console.log('Worker codes are IDENTICAL!');
} else {
  console.log('Worker codes DIFFER!');
  const zdLines = zdWorker.split('\n');
  const testLines = testWorker.split('\n');
  console.log(`ZD lines: ${zdLines.length}, Test lines: ${testLines.length}`);
  for (let i = 0; i < Math.max(zdLines.length, testLines.length); i++) {
    if (zdLines[i] !== testLines[i]) {
      console.log(`Line ${i + 1}:`);
      console.log(`  ZD:   ${zdLines[i]}`);
      console.log(`  Test: ${testLines[i]}`);
      break;
    }
  }
}

// Also compare execute() methods!
const zdExecuteMatch = zdCode.match(/execute\([\s\S]*?return outBuf;\s*\}/);
const testExecuteMatch = testCode.match(/execute\([\s\S]*?return outBuf;\s*\}/);

if (zdExecuteMatch && testExecuteMatch) {
  const zdExec = zdExecuteMatch[0].replace(/\s+/g, ' ');
  const testExec = testExecuteMatch[0].replace(/\s+/g, ' ');
  console.log('Execute methods identical:', zdExec === testExec);
}

