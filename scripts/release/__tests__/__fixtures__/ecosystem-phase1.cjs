// 阶段 1：影子对账开启，路由未切流
module.exports = {
  apps: [{
    name: 'chexian-api',
    script: './dist/index.js',
    env: {
      NODE_ENV: 'production',
      CUBE_SHADOW_COMPARE: 'true',
      CUBE_ROUTING_ENABLED: 'false',
    },
  }],
};
