import fs from 'fs';
import readline from 'readline';

const fileStream = fs.createReadStream('C:/Users/rajeshn/.gemini/antigravity/brain/b97a935e-6e22-419f-9004-5d9532b8ea21/.system_generated/logs/transcript.jsonl');
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

for await (const line of rl) {
  const obj = JSON.parse(line);
  if (obj.step_index === 16371) {
    console.log(obj.content);
    break;
  }
}

