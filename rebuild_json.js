// This script reads the broken JSON, properly escapes content, and rewrites it
const fs = require('fs');

// Read as raw text
let raw = fs.readFileSync('data/raw_articles_batch3.json', 'utf-8');

// Strategy: The Write tool wrote the JSON with:
// 1. Literal newlines inside article 6 (the only one with paragraph breaks)
// 2. Unescaped ASCII quotes inside articles
// We need to fix both

// First, let's identify article boundaries by splitting on the pattern ", "
// that separates array elements
// Actually simpler: manually extract and re-JSON.stringify each article

// Read the original and split into individual article texts
// The original file has: [ "article1", "article2", ... ]
// But with broken escaping. Let me use a regex approach.

// Actually, the simplest fix: replace unescaped " inside strings with Chinese quotes
// Then fix newlines

// Let me try a different approach: read line by line and reconstruct
let lines = raw.split('\n');
let buffer = '';
let articles = [];
let current = null;

for (let line of lines) {
  if (!current) {
    // Looking for start of article
    let startIdx = line.indexOf('  "');
    if (startIdx >= 0 || line.startsWith('["') || line.startsWith('[ "')) {
      // Found potential start
      current = { content: '', depth: 0 };
      // Try to extract content
    }
  }
}

// OK this is too complex. Let me just manually fix the known issue.
// The problem is ONLY in article index 5 (the 6th article about imperial power)
// which has: unescaped " quotes and real newlines

// Simple approach: just replace all ASCII double quotes inside content with Chinese quotes
// then fix newlines

let fixed = raw;
// Replace literal newlines
fixed = fixed.replace(/\r?\n/g, ' ');
// Now the issue is unescaped quotes. Since JSON.stringify uses \",
// the content should have \" but it has raw "

// Actually the problem is that the Write tool wrote literal " characters
// inside JSON strings. We need to find these and escape them.

// A simpler approach: use JSON5 or just manually fix
// Let me try: find all " that are between other " and not properly escaped

// Actually, I think the cleanest solution is to just not use a JSON file at all
// but instead write articles directly to the upload script

console.log('Attempting different approach...');

// Read the original and try to split by the pattern that separates articles
// Articles start with 2 spaces and a quote in the JSON array
let content = raw;

// Replace literal newlines with spaces
content = content.replace(/\r\n/g, ' ').replace(/\n/g, ' ');

// Now try to extract articles using a state machine
let state = 'outside'; // outside, inString, escape
let articles2 = [];
let buf2 = '';
for (let i = 0; i < content.length; i++) {
  let ch = content[i];
  if (state === 'outside') {
    if (ch === '"') {
      state = 'inString';
      buf2 = '';
    }
  } else if (state === 'inString') {
    if (ch === '\\') {
      state = 'escape';
      buf2 += ch;
    } else if (ch === '"') {
      // End of string
      // But is this a real end or an unescaped quote?
      // Check: if the next non-space char is , or ] or : then it's a real end
      let rest = content.substring(i + 1).trimStart();
      if (rest[0] === ',' || rest[0] === ']' || rest[0] === ':') {
        // Real end of string
        articles2.push(buf2);
        state = 'outside';
      } else {
        // Unescaped quote inside string - escape it
        buf2 += '\\"';
      }
    } else {
      buf2 += ch;
    }
  } else if (state === 'escape') {
    state = 'inString';
    buf2 += ch;
  }
}

console.log('Extracted articles:', articles2.length);

if (articles2.length >= 21) {
  // Now create a proper JSON
  let json = JSON.stringify(articles2);
  fs.writeFileSync('data/batch3_final.json', json, 'utf-8');
  // Verify
  let verify = JSON.parse(json);
  console.log('Valid JSON with', verify.length, 'articles');
} else {
  console.log('Extraction failed, only got', articles2.length);
}
