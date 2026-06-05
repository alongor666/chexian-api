#!/usr/bin/env bun
/**
 * 指标注册表校验脚本
 *
 * 用法：bun scripts/metric-registry/validate.ts
 */

import { validateAndReport } from '../../server/src/config/metric-registry/validation.js';

const passed = validateAndReport();
process.exit(passed ? 0 : 1);
