import fs from 'fs';
import readline from 'readline';

const fileStream = fs.createReadStream('C:/Users/rajeshn/.gemini/antigravity/brain/b97a935e-6e22-419f-9004-5d9532b8ea21/.system_generated/logs/transcript_full.jsonl');
const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

for await (const line of rl) {
  const obj = JSON.parse(line);
  if (obj.step_index === 16528 || obj.step_index === 16526 || obj.step_index === 16521) {
    console.log(`Step ${obj.step_index} output snippet:`);
    console.log(obj.content ? obj.content.substring(0, 1000) : 'no content');
  }
}

