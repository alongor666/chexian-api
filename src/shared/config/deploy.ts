/**
 * 部署配置模块
 *
 * 用于管理内网部署相关配置
 * 通过环境变量控制是否自动加载服务器数据
 */

export interface DeployConfig {
  /** 是否自动加载数据 */
  autoLoadData: boolean;
  /** 数据文件URL（相对或绝对路径） */
  dataUrl: string;
  /** 应用标题 */
  appTitle: string;
}

/**
 * 获取部署配置
 *
 * 优先级：环境变量 > 默认值
 */
export function getDeployConfig(): DeployConfig {
  return {
    autoLoadData: import.meta.env.VITE_AUTO_LOAD_DATA === 'true',
    dataUrl: import.meta.env.VITE_DATA_URL || '/data/业务数据.parquet',
    appTitle: import.meta.env.VITE_APP_TITLE || '车险业务分析系统',
  };
}

/**
 * 检查是否为内网部署模式
 */
export function isIntranetDeploy(): boolean {
  return import.meta.env.PROD && getDeployConfig().autoLoadData;
}
