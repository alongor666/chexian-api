import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC = resolve(process.cwd(), '数据管理/VPS同步配置.md');

describe('VPS 同步文档当前态', () => {
  it('使用现行部署别名和域发布命令，不保留私钥/公钥及旧 Windows 主流程', () => {
    const content = readFileSync(DOC, 'utf-8');
    expect(content).toContain('chexian-vps-deploy');
    expect(content).toContain('--domain sales_team_performance --dry-run');
    expect(content).toContain('--domain sales_team_performance --no-restart');
    expect(content).toContain('/usr/local/bin/deploy-chexian-api reload');
    expect(content).toContain('/health');
    expect(content).not.toContain('C:\\Users\\xuechenglong');
    expect(content).not.toContain('ssh-ed25519 AAAA');
  });
});
