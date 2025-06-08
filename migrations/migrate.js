import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kenco_db',
  multipleStatements: true
};

async function runMigrations() {
  let connection;
  try {
    console.log('Connecting to database...', config.host, config.database);
    connection = await mysql.createConnection(config);
    console.log('Database connected successfully');

    // Create migrations table if it doesn't exist
    await connection.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const files = await fs.readdir(__dirname).catch(err => {
      console.error('Error reading migrations directory:', err);
      process.exit(1);
    });
    const migrationFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Get executed migrations
    const [executed] = await connection.query('SELECT name FROM migrations');
    const executedFiles = executed.map(row => row.name);

    // Run pending migrations
    for (const file of migrationFiles) {
      if (!executedFiles.includes(file)) {
        console.log(`Running migration: ${file}`);
        const sql = await fs.readFile(path.join(__dirname, file), 'utf8');
        
        try {
          await connection.query(sql);
          await connection.query('INSERT INTO migrations (name) VALUES (?)', [file]);
          console.log(`Migration successful: ${file}`);
        } catch (error) {
          console.error(`Migration failed: ${file}`);
          console.error('SQL Error:', error.message);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error('Migration error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigrations().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
