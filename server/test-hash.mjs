import * as bcrypt from 'bcrypt';
const isMatch = await bcrypt.compare('CxAdmin@2026!', '$2b$10$04CoRcf7Hk9iSiPD6QWRmelsAGNWoqJ3DGB5Mvfjcc/CH6GEJRUC6');
console.log('Match:', isMatch);
