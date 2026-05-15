const fs = require('fs');

// Read the broken JSON and fix literal newlines inside strings
let raw = fs.readFileSync('data/raw_articles_batch3.json', 'utf-8');
let result = '';
let inStr = false;
for (let i = 0; i < raw.length; i++) {
  let ch = raw[i];
  if (ch === '"' && (i === 0 || raw[i-1] !== '\\')) {
    inStr = !inStr;
    result += ch;
  } else if (inStr && ch === '\n') {
    result += ' ';
  } else if (inStr && ch === '\r') {
    // skip
  } else {
    result += ch;
  }
}
fs.writeFileSync('data/batch3_clean.json', result, 'utf-8');
let arr;
try {
  arr = JSON.parse(result);
  console.log('Fixed JSON valid, articles:', arr.length);
} catch(e) {
  console.log('Still broken:', e.message);
  process.exit(1);
}

// Now upload
const http = require('http');
async function uploadOne(content) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ content });
    const req = http.request({
      hostname: 'localhost', port: 3001, path: '/api/scripts', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('\nUploading ' + arr.length + ' articles...\n');
  for (let i = 0; i < arr.length; i++) {
    const text = arr[i].trim();
    const charCount = text.replace(/\s/g, '').length;
    console.log('[' + (i+1) + '/' + arr.length + '] Uploading (' + charCount + ' chars)...');
    try {
      const result = await uploadOne(text);
      if (result.error) {
        console.log('  -> FAILED: ' + result.error);
      } else {
        console.log('  -> "' + result.title + '" | ' + result.wordCount + '字 | Tags: ' + result.tags.join(', ') + ' | Tone: ' + result.emotionTone);
      }
    } catch (e) {
      console.log('  -> FAILED: ' + e.message);
    }
  }
  console.log('\nDone!');
}
main();
