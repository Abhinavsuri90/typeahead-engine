import { Router, Request, Response } from 'express';
import { sanitize } from '../utils/sanitize';
import { cacheManager } from '../dependencies';

const router = Router();

router.get('/debug', (req: Request, res: Response) => {
  try {
    const prefix = req.query.prefix as string;
    const sanitized = sanitize(prefix);
    
    const nodeId = cacheManager.getNodeForPrefix(sanitized);
    const result = cacheManager.get(sanitized, 'basic');
    
    return res.json({
      node: nodeId || "unknown",
      hit: result !== null,
      data: result
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = cacheManager.getStats();
    return res.json({ nodes: stats });
  } catch (error: any) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
