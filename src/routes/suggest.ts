import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { sanitize } from '../utils/sanitize';
import { getSuggestions } from '../services/suggestionService';
import { cacheManager } from '../dependencies';

const router = Router();

export const suggestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10000,
  message: { error: "Too many requests, slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(suggestLimiter);

router.get('/', async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    let modeStr = req.query.mode as string;
    
    const sanitized = sanitize(q);
    if (!sanitized) {
      return res.json({ suggestions: [] });
    }
    
    if (q && q.length > 100) {
      return res.status(400).json({ error: "Query too long" });
    }
    
    const mode = (modeStr === 'basic' || modeStr === 'trending') ? modeStr : 'basic';
    
    const nodeId = cacheManager.getNodeForPrefix(sanitized);
    const isHit = cacheManager.get(sanitized, mode) !== null;
    
    if (nodeId) {
      res.setHeader('X-Cache-Node', nodeId);
      res.setHeader('X-Cache-Hit', isHit ? 'true' : 'false');
    }

    const results = await getSuggestions(sanitized, mode);
    return res.json({ suggestions: results });
  } catch (err: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
