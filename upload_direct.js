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

// Read the original JSON file, fix it, and upload
const fs = require('fs');
let raw = fs.readFileSync('data/raw_articles_batch3.json', 'utf-8');
// Replace actual newlines with spaces to make valid JSON
raw = raw.replace(/\r?\n/g, ' ');
let articles;
try {
  articles = JSON.parse(raw);
} catch(e) {
  console.log('JSON parse failed, trying line-by-line fix...');
  // Try another approach: read the write output which has proper escaping
  process.exit(1);
}

async function main() {
  console.log(`Uploading ${articles.length} new articles...\n`);
  for (let i = 0; i < articles.length; i++) {
    const text = articles[i].trim();
    const charCount = text.replace(/\s/g, '').length;
    console.log(`[${i + 1}/${articles.length}] Uploading (${charCount} chars)...`);
    try {
      const result = await uploadOne(text);
      if (result.error) {
        console.log(`  -> FAILED: ${result.error}`);
      } else {
        console.log(`  -> "${result.title}" | ${result.wordCount}字 | Tags: ${result.tags.join(', ')} | Tone: ${result.emotionTone}`);
      }
    } catch (e) {
      console.log(`  -> FAILED: ${e.message}`);
    }
  }
  console.log('\nDone!');
}
main();
