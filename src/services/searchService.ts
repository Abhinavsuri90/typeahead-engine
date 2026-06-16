import { isValidQuery } from '../utils/sanitize';
import { batchWriter } from '../dependencies';

export async function submitSearch(query: string): Promise<{ message: string }> {
  if (!isValidQuery(query)) {
    throw { error: "Invalid query", code: 400 };
  }

  batchWriter.push(query);
  return { message: "Searched" };
}
