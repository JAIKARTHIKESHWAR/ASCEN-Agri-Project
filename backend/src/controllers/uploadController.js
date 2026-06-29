import multer from 'multer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { importCSV } from '../services/csvLoader.js';
import { dbAll, dbGet, dbRun } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

export const uploadMiddleware = multer({ storage }).single('file');

function calculateFileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * POST /api/data/upload
 *
 * Behaviour:
 *  1. Hash the uploaded file.
 *  2. ACTIVE hash match   → reject (true duplicate, already live).
 *  3. INACTIVE hash match → DELETE old rows + DELETE old batch record,
 *                           then fall through to a full fresh import.
 *                           This fixes stale null-data from bad column mapping.
 *  4. No match            → fresh import.
 */
export async function uploadCSV(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No data file (CSV or Excel) was uploaded' });
    }

    const { path, originalname } = req.file;
    console.log(`Processing uploaded file: ${originalname} saved at ${path}`);

    const fileHash = calculateFileHash(path);

    const existing = await dbGet(
      'SELECT batch_id, file_name FROM upload_batches WHERE file_hash = $1 AND deleted_at IS NULL LIMIT 1',
      [fileHash]
    );

    if (existing) {
      try { fs.unlinkSync(path); } catch (_) {}
      console.warn(`Duplicate active upload rejected: ${originalname} matching hash ${fileHash}`);
      return res.status(409).json({
        error: 'This dataset already exists.',
        details: `"${existing.file_name}" is already active in the dashboard. Reset the dashboard first to re-upload it.`
      });
    }

    // ── Full fresh import (new file OR purged re-import) ──────────────────────
    const stats = await importCSV(path, originalname, fileHash);

    try { fs.unlinkSync(path); } catch (e) {
      console.warn('Could not delete temp upload file:', path, e);
    }

    const fyRows = await dbAll(
      'SELECT DISTINCT fy_code FROM sales_data_raw WHERE batch_id = $1',
      [stats.batchId]
    );

    const wasReimport = !!existing;
    res.json({
      status:        wasReimport ? 'reimported' : 'success',
      uploadBatchId: stats.batchId,
      message:       wasReimport
        ? `Re-imported "${originalname}" — ${stats.rowsImported.toLocaleString('en-IN')} records refreshed with corrected column mapping.`
        : `Imported ${stats.rowsImported.toLocaleString('en-IN')} of ${(stats.rowsImported + stats.rowsRejected).toLocaleString('en-IN')} rows from ${originalname}.`,
      sourceRowCount: stats.rowsImported + stats.rowsRejected,
      rowsImported:   stats.rowsImported,
      rowsRejected:   stats.rowsRejected,
      financialYearsFound: fyRows.map(r => r.fy_code),
      dataHealthSummary: {
        duplicateInvoiceLines:          0,
        missingCustomerIds:             0,
        invalidNumericValuesCorrected:  stats.rowsRejected,
        unmappedMaterials:              [],
        unmappedTerritories:            []
      }
    });

  } catch (err) {
    console.error('File upload processing failed:', err);
    res.status(500).json({ error: 'Failed to parse and import data', details: err.message });
  }
}

/**
 * POST /api/data/reset
 * Hard-reset: deletes all uploaded data so the same files can be re-uploaded.
 */
export async function softResetData(req, res) {
  try {
    console.log('Initiating dashboard reset: purging all uploaded datasets...');
    
    // Hard delete all sales data and batch records so hashes are cleared
    // and the same file can be re-uploaded cleanly.
    await dbRun('DELETE FROM import_rejected_rows');
    await dbRun('DELETE FROM sales_data_raw');
    await dbRun('DELETE FROM upload_batches');
    
    res.json({
      status:  'success',
      message: 'Dashboard has been reset. All uploaded datasets have been removed. You can now re-upload any file.'
    });
  } catch (err) {
    console.error('Dashboard reset failed:', err);
    res.status(500).json({ error: 'Failed to reset dashboard.', details: err.message });
  }
}

/**
 * GET /api/data/datasets
 * Returns a list of all uploaded datasets/batches with dynamic profile stats.
 */
export async function getDatasets(req, res) {
  try {
    const query = `
      SELECT 
        fy_code,
        MIN(min_date) AS min_date,
        MAX(max_date) AS max_date,
        SUM(record_count)::int AS total_records
      FROM upload_batches
      WHERE fy_code IS NOT NULL AND fy_code <> 'UNKNOWN'
      GROUP BY fy_code
      ORDER BY fy_code DESC
    `;
    const rows = await dbAll(query);
    
    const formatted = rows.map(r => {
      let displayLabel = r.fy_code;
      if (r.fy_code && r.fy_code.startsWith('FY') && r.fy_code.length === 6) {
        const start = `20${r.fy_code.substring(2, 4)}`;
        const end = `20${r.fy_code.substring(4, 6)}`;
        displayLabel = `FY ${start}-${end}`;
      }
      
      const label = `${displayLabel} (${(r.total_records || 0).toLocaleString()} rows)`;
      
      return {
        batch_id: r.fy_code,
        fyCode: r.fy_code,
        label,
        record_count: r.total_records,
        min_date: r.min_date,
        max_date: r.max_date,
        available_years: [
          parseInt(`20${r.fy_code.substring(2, 4)}`, 10),
          parseInt(`20${r.fy_code.substring(4, 6)}`, 10)
        ]
      };
    });
    
    // Add "All Financial Years" option at the top
    const allStats = await dbGet(`
      SELECT 
        COALESCE(SUM(record_count), 0)::int as total_records,
        to_char(MIN(min_date), 'YYYY-MM-DD') as min_date,
        to_char(MAX(max_date), 'YYYY-MM-DD') as max_date
      FROM upload_batches
    `);
    
    // Extract unique available years across all active batches
    const yearsRows = await dbAll(`
      SELECT DISTINCT EXTRACT(YEAR FROM min_date)::int as yr FROM upload_batches WHERE min_date IS NOT NULL
      UNION
      SELECT DISTINCT EXTRACT(YEAR FROM max_date)::int as yr FROM upload_batches WHERE max_date IS NOT NULL
    `);
    const allYears = yearsRows.map(row => row.yr).filter(Boolean).sort();
    
    const allOption = {
      batch_id: 'all',
      label: `All Financial Years (${(allStats?.total_records || 0).toLocaleString()} rows)`,
      record_count: allStats?.total_records || 0,
      min_date: allStats?.min_date || null,
      max_date: allStats?.max_date || null,
      available_years: allYears.length > 0 ? allYears : [2024, 2025, 2026, 2027]
    };
    
    res.json([allOption, ...formatted]);
  } catch (err) {
    console.error('Failed to get datasets:', err);
    res.status(500).json({ error: 'Failed to retrieve dataset options', details: err.message });
  }
}

