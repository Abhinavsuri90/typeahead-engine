import { Router, Request, Response } from 'express';
import { sanitize } from '../utils/sanitize';
import { getTrending, compareTrendingVsBasic } from '../services/trendingService';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const windowStr = req.query.window as string;
    let windowHours = 168;
    
    if (windowStr) {
      if (['1', '6', '24', '168'].includes(windowStr)) {
        windowHours = Number(windowStr);
      } else {
        windowHours = 168; // default if invalid
      }
    }
    
    const results = await getTrending(windowHours);
    return res.json({ trending: results, windowHours, count: results.length });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get('/compare', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const sanitized = sanitize(q);
    
    if (!sanitized) {
      return res.status(400).json({ error: "Prefix required" });
    }
    
    const result = await compareTrendingVsBasic(sanitized);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
