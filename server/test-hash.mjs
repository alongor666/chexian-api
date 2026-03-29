import * as bcrypt from 'bcrypt';
const isMatch = await bcrypt.compare('dev', '$2b$10$04CoRcf7Hk9iSiPD6QWRmelsAGNWoqJ3DGB5Mvfjcc/CH6GEJRUC6');
console.log('Match:', isMatch);
