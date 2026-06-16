export function sanitize(input: unknown): string {
  if (input === null || input === undefined || typeof input !== 'string') {
    return '';
  }
  
  let cleaned = input.trim().toLowerCase();
  cleaned = cleaned.replace(/[^a-z0-9 -]/g, '');
  
  if (cleaned.length > 100) {
    cleaned = cleaned.substring(0, 100);
  }
  
  return cleaned;
}

export function isValidQuery(input: unknown): boolean {
  return sanitize(input).length > 0;
}
