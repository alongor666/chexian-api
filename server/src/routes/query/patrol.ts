/**
 * 巡检报告路由
 *
 * 读取离线巡检引擎产出的 JSON 文件并返回。
 * 巡检由 Python patrol_engine.py 预计算，API 只做读文件。
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import { getPatrolReportPaths } from '../../config/paths.js';

const router = Router();

/**
 * GET /api/query/patrol/:domain
 * 返回指定域的最新巡检报告
 */
router.get('/patrol/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;

  // 只允许已知域
  const allowedDomains = ['renewal'];
  if (!allowedDomains.includes(domain)) {
    res.status(400).json({ success: false, error: { message: `未知巡检域: ${domain}`, statusCode: 400 } });
    return;
  }

  const candidatePaths = getPatrolReportPaths(domain);

  for (const filePath of candidatePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      res.json({ success: true, data: { report: data, domain, source: filePath.includes('patrol_reports') ? 'local' : 'vps' } });
      return;
    } catch {
      // 文件不存在，尝试下一个路径
    }
  }

  res.status(404).json({
    success: false,
    error: { message: `巡检报告不存在: ${domain}`, statusCode: 404 },
  });
});

export default router;
