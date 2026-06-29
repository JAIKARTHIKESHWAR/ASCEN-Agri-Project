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

  // 1. Assert: Net Sales should never exceed Gross Sales
  if (net > gross + 0.01) { // Allowing tiny floating point margin
    throw new AnalyticsValidationError(
      `Invalid Net External Sales calculation: Net Sales (${net}) exceeds Gross Sales (${gross}).`,
      { gross, returns, cancelled, net }
    );
  }

  // 2. Assert: Returns should never exceed Gross Sales
  if (returns > gross + 0.01 && gross > 0) {
    throw new AnalyticsValidationError(
      `Invalid returns data: Returns (${returns}) exceeds Gross Sales (${gross}).`,
      { gross, returns, cancelled, net }
    );
  }

  // 3. Assert: Cancelled invoices should never exceed Gross Sales
  if (cancelled > gross + 0.01 && gross > 0) {
    throw new AnalyticsValidationError(
      `Invalid cancellation data: Cancelled (${cancelled}) exceeds Gross Sales (${gross}).`,
      { gross, returns, cancelled, net }
    );
  }

  return true;
}
