/**
 * 路径配置
 * Path Configuration
 *
 * 使用 import.meta.url 计算稳定的绝对路径，不依赖 process.cwd()。
 * 解决从不同目录启动时 data/ 路径解析错误的问题。
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** server/ 目录的绝对路径（从 server/src/config/ 向上两级） */
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

/** 获取 server/data/ 目录的绝对路径 */
export function getDataDir(): string {
  return path.resolve(SERVER_ROOT, 'data');
}
