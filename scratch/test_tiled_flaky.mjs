import { execSync } from 'node:child_process';

for (let i = 1; i <= 5; i++) {
  try {
    const out = execSync('node tests/test_tiled_graph_workflows.mjs', { encoding: 'utf8' });
    console.log(`Run ${i}: PASSED`);
  } catch (err) {
    const lines = err.stdout.split('\n');
    const zdLine = lines.find(l => l.includes('Workflow 4'));
    console.log(`Run ${i}: FAILED -> ${zdLine || err.message}`);
  }
}

