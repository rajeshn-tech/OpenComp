import fs from 'fs';

for (const doc of fs.readdirSync('Documents')) {
  const content = fs.readFileSync(`Documents/${doc}`, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('552') || (l.toLowerCase().includes('zdefocus') && l.includes('ms'))) {
      console.log(`[${doc}:${i+1}] ${l}`);
    }
  });
}

