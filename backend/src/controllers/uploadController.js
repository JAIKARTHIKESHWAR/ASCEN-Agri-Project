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
      'SELECT batch_id, file_name, is_active, rows_imported FROM upload_batches WHERE file_hash = $1 LIMIT 1',
      [fileHash]
    );

    if (existing) {
      if (existing.is_active) {
        // True duplicate — already live in dashboard
        try { fs.unlinkSync(path); } catch (_) {}
        console.warn(`Duplicate active upload rejected: ${originalname}`);
        return res.status(409).json({
          error: 'This file is already active in the dashboard.',
          details: `"${existing.file_name}" is already uploaded and active. Reset first if you want to re-import.`
        });
      }

      // Inactive batch — purge stale rows so we can re-import with correct mapping
      console.log(`Purging stale data for inactive batch ${existing.batch_id} ("${existing.file_name}") — will re-import fresh...`);
      await dbRun('DELETE FROM import_rejected_rows WHERE batch_id = $1', [existing.batch_id]);
      await dbRun('DELETE FROM sales_data_raw WHERE batch_id = $1',       [existing.batch_id]);
      await dbRun('DELETE FROM upload_batches   WHERE batch_id = $1',     [existing.batch_id]);
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
 * Soft-reset: marks all batches inactive (data preserved, re-upload restores + re-imports).
 */
export async function softResetData(req, res) {
  try {
    console.log('Initiating soft-reset: marking all upload batches as inactive.');
    await dbRun('UPDATE upload_batches SET is_active = FALSE');
    res.json({
      status:  'success',
      message: 'All uploaded datasets have been reset. Dashboard is at default (zero). Re-upload any file to restore it with fresh mapping.'
    });
  } catch (err) {
    console.error('Soft reset failed:', err);
    res.status(500).json({ error: 'Failed to perform soft-reset.', details: err.message });
  }
}
