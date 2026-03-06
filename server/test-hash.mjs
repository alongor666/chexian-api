import * as bcrypt from 'bcrypt';
const isMatch = await bcrypt.compare('CxAdmin@2026!', '$2b$10$X.cHV7Z0RpL8geG2lrDBsuLXNW6rnbd1x1z.d8hmucvMazpbvUTU2');
console.log('Match:', isMatch);
