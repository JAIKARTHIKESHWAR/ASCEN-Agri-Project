// backend/src/logger.js

/** Simple logger utility */
export const logger = {
  info: (msg) => console.info('[INFO]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  warn: (msg) => console.warn('[WARN]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  error: (msg) => console.error('[ERROR]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  debug: (msg) => console.debug('[DEBUG]', typeof msg === 'object' ? JSON.stringify(msg) : msg)
};
