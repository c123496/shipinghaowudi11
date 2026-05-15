const http = require('http');
const fs = require('fs');

const raw = fs.readFileSync('data/raw_articles_new.json', 'utf-8');
const articles = JSON.parse(raw);

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
