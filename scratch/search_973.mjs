import fs from 'fs';
import readline from 'readline';

const fileStream = fs.createReadStream('C:/Users/rajeshn/.gemini/antigravity/brain/b97a935e-6e22-419f-9004-5d9532b8ea21/.system_generated/logs/transcript.jsonl');
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

for await (const line of rl) {
  if (line.includes('973.95')) {
    const obj = JSON.parse(line);
    console.log(`Step ${obj.step_index}: source=${obj.source}`);
    if (obj.content) {
      const idx = obj.content.indexOf('973.95');
      console.log('Snippet:', obj.content.substring(Math.max(0, idx - 100), Math.min(obj.content.length, idx + 150)));
    }
  }
}

