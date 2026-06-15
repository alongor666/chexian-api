// 非法状态：SHADOW=false，ROUTING=true（路由打开但影子未开，实际等同阶段 0 处理）
module.exports = {
  apps: [{
    name: 'chexian-api',
    script: './dist/index.js',
    env: {
      NODE_ENV: 'production',
      CUBE_SHADOW_COMPARE: 'false',
      CUBE_ROUTING_ENABLED: 'true',
    },
  }],
};
