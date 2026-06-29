// backend/src/utils/formatUtils.js

/**
 * Convert a date string (YYYY-MM) to a short human format, e.g., "Sep 24".
 */
export function formatMonthLabel(dateStr) {
  if (!dateStr) return 'N/A';
  const parts = dateStr.split('-');
  const year = parts[0].substring(2);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[monthIdx] || 'Unk'} ${year}`;
}
