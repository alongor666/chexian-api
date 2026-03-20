import bcrypt from 'bcrypt';


console.log('USER_PASSWORDS exists?', !!process.env.USER_PASSWORDS);
if (process.env.USER_PASSWORDS) {
  try {
    console.log('First 50 chars:', process.env.USER_PASSWORDS.substring(0, 50));
    const parsed = JSON.parse(process.env.USER_PASSWORDS);
    console.log('tianfu hash:', parsed.tianfu);
    console.log('admin hash:', parsed.admin);

    bcrypt.compare('123456', parsed.tianfu).then(res => console.log('Does 123456 match tianfu on VPS?', res));
    bcrypt.compare('123456', parsed.admin).then(res => console.log('Does 123456 match admin on VPS?', res));
  } catch(e) {
    console.error('JSON Parse Error:', e.message);
  }
}
