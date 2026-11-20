import fs from 'fs';
import path from 'path';

function searchDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      searchDir(full);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('552')) {
        console.log(`Found in: ${full}`);
      }
    }
  }
}
searchDir('.');

