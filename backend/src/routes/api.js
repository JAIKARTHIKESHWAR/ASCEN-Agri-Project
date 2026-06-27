import express from 'express';
import { 
  getSummary, 
  getSalesPerformance, 
  getGeography, 
  getProductPerformance, 
  getReturns, 
  getFiltersOptions, 
  getImportQuality 
} from '../controllers/dashboardController.js';
import { 
  getTransactions, 
  exportTransactions 
} from '../controllers/transactionController.js';
import { askQuestion } from '../controllers/askController.js';
import { uploadMiddleware, uploadCSV } from '../controllers/uploadController.js';
import { login } from '../controllers/authController.js';
import { bootstrapSession, newSession, getSessionHistory } from '../controllers/copilotController.js';

const router = express.Router();

// 1. Executive Summary Endpoint
router.get('/dashboard/summary', getSummary);

// 2. Sales Performance Endpoint
router.get('/dashboard/sales', getSalesPerformance);

// 3. Geography & Regions Endpoint
router.get('/dashboard/geography', getGeography);

// 4. Crop & Product Performance Endpoint
router.get('/dashboard/product', getProductPerformance);

// 5. Returns Analysis Endpoint
router.get('/dashboard/returns', getReturns);

// 6. Transactions Drill-down List Endpoint
router.get('/transactions', getTransactions);

// 7. Transactions Export (CSV) Endpoint
router.get('/transactions/export', exportTransactions);

// 8. Ask AI Assistant Chat Query Endpoint
router.post('/ask', askQuestion);

// 9. Bulk Data CSV File Upload Endpoint
router.post('/data/upload', uploadMiddleware, uploadCSV);

// 10. Filters options dropdowns cascading Endpoint
router.get('/filters/options', getFiltersOptions);

// 11. Batch quality analysis review Endpoint
router.get('/data/quality/:batchId', getImportQuality);

// 12. Authentication login Endpoint
router.post('/auth/login', login);

// 13. Copilot Stateful Session Endpoints
router.post('/copilot/session', bootstrapSession);
router.post('/copilot/new', newSession);
router.get('/copilot/history/:sessionId', getSessionHistory);

export default router;
