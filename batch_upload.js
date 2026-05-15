const http = require('http');
const fs = require('fs');

// Read all articles from raw text file
const raw = fs.readFileSync('data/raw_articles.json', 'utf-8');
const articles = JSON.parse(raw);

async function uploadOne(content) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ content });
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/scripts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  // First delete existing articles
  const existing = await new Promise((resolve, reject) => {
    http.get('http://localhost:3001/api/scripts', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });

  for (const script of existing) {
    await new Promise((resolve) => {
      http.get(`http://localhost:3001/api/scripts?id=${script.id}`, { method: 'DELETE' }, res => {
        res.resume();
        res.on('end', resolve);
      });
    });
    console.log(`Deleted: ${script.title}`);
  }

  console.log(`\nUploading ${articles.length} articles...\n`);

  for (let i = 0; i < articles.length; i++) {
    const text = articles[i].trim();
    const charCount = text.replace(/\s/g, '').length;
    console.log(`[${i + 1}/${articles.length}] Uploading (${charCount} chars)...`);

    try {
      const result = await uploadOne(text);
      console.log(`  -> "${result.title}" | ${result.wordCount}字 | Tags: ${result.tags.join(', ')} | Tone: ${result.emotionTone}`);
    } catch (e) {
      console.log(`  -> FAILED: ${e.message}`);
    }
  }

  console.log('\nDone!');
}

main();
