const http = require('http');
const fs = require('fs');

// Read raw text, split by numbered markers
const rawText = fs.readFileSync('data/raw_articles_batch3_text.txt', 'utf-8');

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

// We'll use a simpler approach: store articles in a JS module
async function main() {
  // Load articles from the JS array file
  delete require.cache[require.resolve('./articles_batch3.js')];
  const articles = require('./articles_batch3.js');

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
