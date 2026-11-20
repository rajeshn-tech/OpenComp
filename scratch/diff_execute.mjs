import fs from 'node:fs';

const zdCode = fs.readFileSync('src/nodes/ZDefocusNode.js', 'utf8');
const testCode = fs.readFileSync('scratch/test_race_condition.mjs', 'utf8');

const zdExecuteMatch = zdCode.match(/execute\([\s\S]*?return outBuf;\s*\}/);
const testExecuteMatch = testCode.match(/execute\([\s\S]*?return outBuf;\s*\}/);

const zdLines = zdExecuteMatch[0].split('\n');
const testLines = testExecuteMatch[0].split('\n');

for (let i = 0; i < Math.max(zdLines.length, testLines.length); i++) {
  if (zdLines[i] !== testLines[i]) {
    console.log(`Diff at line ${i + 1}:`);
    console.log('  ZD:   ', zdLines[i]);
    console.log('  Test: ', testLines[i]);
  }
}

