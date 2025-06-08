import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
  timezone: 'Z',
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true
  } : false,
  debug: process.env.NODE_ENV === 'development',
};

export const createPool = () => mysql.createPool(dbConfig);

export const createConnection = async () => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // Add connection error handler
    connection.on('error', async (err) => {
      console.error('Database connection error:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Attempting to reconnect...');
        return await createConnection();
      }
      throw err;
    });
    
    return connection;
  } catch (err) {
    console.error('Failed to create database connection:', err);
    throw err;
  }
};

// Add connection pool events
export const initializePool = () => {
  const pool = createPool();
  
  pool.on('connection', connection => {
    console.log('New connection established with server...');
  });

  pool.on('error', err => {
    console.error('Database pool error:', err);
  });

  return pool;
};
