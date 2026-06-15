// 阶段 0：两个开关均为 false（立方体未启用）
module.exports = {
  apps: [{
    name: 'chexian-api',
    script: './dist/index.js',
    env: {
      NODE_ENV: 'production',
      CUBE_SHADOW_COMPARE: 'false',
      CUBE_ROUTING_ENABLED: 'false',
    },
  }],
};
