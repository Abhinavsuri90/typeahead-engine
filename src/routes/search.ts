import { Router, Request, Response } from 'express';
import { isValidQuery } from '../utils/sanitize';
import { submitSearch } from '../services/searchService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    
    if (!isValidQuery(query)) {
      return res.status(400).json({ error: "Invalid query" });
    }
    
    const result = await submitSearch(query);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
