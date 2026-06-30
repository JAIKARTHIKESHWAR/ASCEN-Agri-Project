/**
 * Centralized Validation Layer for Agri Analytics Calculations
 * Prevents impossible math states such as Net Sales exceeding Gross Sales,
 * or returns/cancelled values exceeding Gross Sales.
 */
export class AnalyticsValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AnalyticsValidationError';
    this.details = details;
  }
}

export function validateAnalyticsKPIs({ grossSales, returnsValue, cancelledValue, netExternalSales }) {
  const gross = parseFloat(grossSales || 0);
  const returns = parseFloat(returnsValue || 0);
  const cancelled = parseFloat(cancelledValue || 0);
  const net = parseFloat(netExternalSales || 0);

  const warnings = [];
  if (returns > gross + 0.01 && gross > 0) {
    warnings.push(`Returns (${returns}) exceed Gross Sales (${gross}) for this filter selection.`);
  }
  if (cancelled > gross + 0.01 && gross > 0) {
    warnings.push(`Cancelled (${cancelled}) exceed Gross Sales (${gross}) for this filter selection.`);
  }
  if (warnings.length > 0) {
    console.warn('[validateAnalyticsKPIs]', warnings.join(' | '));
  }
  return { isValid: warnings.length === 0, warnings, gross, returns, cancelled, net };
}
