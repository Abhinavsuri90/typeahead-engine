import fs from 'fs';
import path from 'path';

const TOTAL_QUERIES = 100000;
const OUTPUT_FILE = path.join(__dirname, '../../data/queries.csv');

// List of base terms to generate queries from
const BASE_TERMS = [
  "iphone", "macbook", "ipad", "airpods", "samsung galaxy", 
  "pixel", "headphones", "monitor", "keyboard", "mouse",
  "charger", "cable", "laptop", "tv", "speaker",
  "book", "shoes", "shirt", "watch", "camera"
];

// List of suffixes to append
const SUFFIXES = [
  "pro", "max", "mini", "ultra", "wireless", "bluetooth",
  "gaming", "4k", "usb c", "hdmi", "black", "white",
  "sale", "cheap", "review", "case", "cover", "stand"
];

function generateDataset() {
  console.log(`Generating ${TOTAL_QUERIES} queries to ${OUTPUT_FILE}...`);
  
  // Create data directory if it doesn't exist
  const dataDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const stream = fs.createWriteStream(OUTPUT_FILE);
  stream.write('query,count\n');

  const generated = new Set<string>();
  
  // First, add exact base terms with high counts
  for (const term of BASE_TERMS) {
    if (generated.size >= TOTAL_QUERIES) break;
    const count = Math.floor(Math.random() * 90000) + 10000; // 10k-100k
    stream.write(`"${term}",${count}\n`);
    generated.add(term);
  }

  // Generate random combinations
  while (generated.size < TOTAL_QUERIES) {
    const base = BASE_TERMS[Math.floor(Math.random() * BASE_TERMS.length)];
    const numSuffixes = Math.floor(Math.random() * 3) + 1; // 1 to 3 suffixes
    
    let queryParts = [base];
    for (let i = 0; i < numSuffixes; i++) {
      queryParts.push(SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]);
    }
    
    // Add random letters/numbers to make them unique if needed
    if (Math.random() > 0.7) {
      queryParts.push(Math.floor(Math.random() * 100).toString());
    }

    const query = queryParts.join(" ");
    
    if (!generated.has(query)) {
      // Zipfian distribution-like counts (most have small counts, few have large)
      const count = Math.max(1, Math.floor(10000 / (Math.random() * 1000 + 1)));
      stream.write(`"${query}",${count}\n`);
      generated.add(query);
      
      if (generated.size % 10000 === 0) {
        process.stdout.write(`\rProgress: ${generated.size}/${TOTAL_QUERIES}`);
      }
    }
  }

  stream.end();
  console.log(`\n\nDone! Successfully generated ${TOTAL_QUERIES} queries.`);
  console.log(`To load into the database, run: npm run seed`);
}

generateDataset();
