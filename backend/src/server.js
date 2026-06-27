import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { seedDatabaseIfEmpty } from './services/csvLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env variables (reloaded)
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', 'ai', '.env') });

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS and JSON parsing
app.addMiddleware ? app.addMiddleware(cors()) : app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Seed database on startup and listen
async function startServer() {
  try {
    // Populate SQLite database from CSV file if it's empty
    await seedDatabaseIfEmpty();
    
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Node.js Sales Analytics server running at http://127.0.0.1:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize and start server:', err);
    process.exit(1);
  }
}

startServer();
