import express from 'express';
import cors from 'cors';

const app = express();

// Enable CORS for frontend
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));

// ...existing code...