/**
 * 生成密码哈希的脚本
 */
import bcrypt from 'bcrypt';

const passwords = {
  admin123: '',
  leshan123: '',
  tianfu123: '',
};

async function generateHashes() {
  for (const [password, _] of Object.entries(passwords)) {
    const hash = await bcrypt.hash(password, 10);
    console.log(`${password}: ${hash}`);
  }
}

generateHashes();
