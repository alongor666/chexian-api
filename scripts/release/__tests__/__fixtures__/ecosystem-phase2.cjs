// 阶段 2：两开关均 true（正式切流）
module.exports = {
  apps: [{
    name: 'chexian-api',
    script: './dist/index.js',
    env: {
      NODE_ENV: 'production',
      CUBE_SHADOW_COMPARE: 'true',
      CUBE_ROUTING_ENABLED: 'true',
    },
  }],
};
