/**
 * 生成密码哈希的脚本
 *
 * 用法：tsx server/scripts/hash-password.ts <password> [<password> ...]
 * 不在源码中硬编码任何明文密码——待哈希的口令一律从命令行参数传入。
 */
import bcrypt from 'bcrypt';

async function generateHashes() {
  const passwords = process.argv.slice(2);
  if (passwords.length === 0) {
    console.error('用法：tsx server/scripts/hash-password.ts <password> [<password> ...]');
    process.exit(1);
  }
  for (const password of passwords) {
    const hash = await bcrypt.hash(password, 10);
    console.log(`${password}: ${hash}`);
  }
}

generateHashes();
