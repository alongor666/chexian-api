const likePattern = /^(\w+)\s+LIKE\s+'[^']*'$/i;
const filter = "org_level_3 LIKE '%乐山%' ESCAPE '\\'";
console.log(likePattern.test(filter));
