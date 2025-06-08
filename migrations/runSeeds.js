import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPool } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runSeeds() {
  const pool = createPool();
  
  try {
    // Get list of seed files
    const seedPath = path.join(__dirname, 'seed');
    const files = await fs.readdir(seedPath);
    const seedFiles = files.filter(f => f.endsWith('.sql')).sort();

    // Run seeds in order
    for (const file of seedFiles) {
      console.log(`Running seed: ${file}`);
      const sql = await fs.readFile(path.join(seedPath, file), 'utf8');
      
      await pool.query(sql);
      console.log(`Completed seed: ${file}`);
    }

  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSeeds().then(() => {
  console.log('All seeds completed successfully');
  process.exit(0);
});
