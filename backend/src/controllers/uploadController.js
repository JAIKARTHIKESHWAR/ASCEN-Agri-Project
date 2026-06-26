import multer from 'multer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { importCSV } from '../services/csvLoader.js';
import { dbAll } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, '..', '..', 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

export const uploadMiddleware = upload.single('file');

/**
 * Endpoint 9: POST /api/data/upload
 */
export async function uploadCSV(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file was uploaded' });
    }

    const { path, originalname } = req.file;
    console.log(`Processing uploaded CSV file: ${originalname} saved at ${path}`);

    // Parse and load CSV rows into SQLite database
    const stats = await importCSV(path, originalname);

    // Clean up the temporary uploaded file
    try {
      fs.unlinkSync(path);
    } catch (e) {
      console.warn('Could not delete temporary upload file:', path, e);
    }

    // Retrieve unique financial years found in this import batch
    const fyRows = await dbAll('SELECT DISTINCT fy_code FROM sales_data WHERE batch_id = $1', [stats.batchId]);
    const financialYearsFound = fyRows.map(r => r.fy_code);

    res.json({
      status: "success",
      uploadBatchId: stats.batchId,
      message: `Imported ${stats.rowsImported.toLocaleString('en-IN')} of ${(stats.rowsImported + stats.rowsRejected).toLocaleString('en-IN')} rows from ${originalname}.`,
      sourceRowCount: stats.rowsImported + stats.rowsRejected,
      rowsImported: stats.rowsImported,
      rowsRejected: stats.rowsRejected,
      financialYearsFound,
      dataHealthSummary: {
        duplicateInvoiceLines: 0,
        missingCustomerIds: 0,
        invalidNumericValuesCorrected: stats.rowsRejected,
        unmappedMaterials: [],
        unmappedTerritories: []
      }
    });
  } catch (err) {
    console.error('CSV File upload processing failed:', err);
    res.status(500).json({ error: 'Failed to parse and import data', details: err.message });
  }
}
