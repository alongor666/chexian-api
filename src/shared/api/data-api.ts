/**
 * 数据管理子客户端（ApiClient 神类拆分 Phase 2 · data 域）
 *
 * 挂载点：apiClient.data.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 4 个端点：
 *   - files()      GET  /data/files        — 文件列表
 *   - load(fn)     POST /data/load/<fn>    — 加载数据文件
 *   - upload(f)    POST /data/upload       — multipart 上传（⚠️ 不走 JSON request()，
 *                                            直接 fetch + FormData；用 t.getToken() 取 Bearer）
 *   - version()    GET  /data/version      — ETL 数据版本
 *
 * upload 为本域唯一 multipart 方法，行为与原 ApiClient.uploadFile 逐字符等价：
 * 照搬 FormData + Authorization header 构造，移植 ApiResponse 反序列化与错误抛出。
 */

import { DATA_ROUTES } from './routes';
import { API_BASE, type ApiTransport } from './client-core';
import type { ApiResponse, FileInfo, LoadResult } from './types';

/**
 * 数据元信息（GET /data/metadata 返回体的前端消费子集）
 *
 * 本客户端仅消费 `file`（用于派生"后端数据已就绪"）；schema/dateRange/
 * organizations/summaryStats 等字段后端会返回但此处不建模，避免过度耦合。
 */
export interface DataMetadataResult {
  file: {
    filename: string;
    originalName?: string;
    uploadTime?: string;
    /** 行级过滤后的可见行数（org_user 为本机构行数，可能为 0，不用于就绪判定） */
    rowCount: number;
    fileSizeMB: number | null;
  };
}

export class DataApi {
  constructor(private readonly t: ApiTransport) {}

  /** 获取文件列表（后端 requireRole(BRANCH_ADMIN)，org_user 调用恒 403） */
  files(): Promise<FileInfo[]> {
    return this.t.request<FileInfo[]>(`/data/${DATA_ROUTES.FILES}`);
  }

  /**
   * 获取当前数据元信息（角色无关的就绪探测）
   *
   * 与 files() 不同：/data/metadata 无 requireRole，仅经 router 级 permissionMiddleware
   * 做行级过滤。PolicyFact 存在即返回 200（org_user 亦然），表不存在才抛 404。
   * 因此可用"metadata 返回 200"派生全局 isDataLoaded，而不泄漏跨机构文件名/数据。
   */
  metadata(): Promise<DataMetadataResult> {
    return this.t.request<DataMetadataResult>(`/data/${DATA_ROUTES.METADATA}`);
  }

  /** 加载数据文件 */
  load(filename: string): Promise<LoadResult> {
    return this.t.request<LoadResult>(`/data/${DATA_ROUTES.LOAD}/${encodeURIComponent(filename)}`, {
      method: 'POST',
    });
  }

  /**
   * 上传文件（multipart/form-data）
   *
   * 无法走 JSON request()，直接使用原生 fetch + FormData。
   * 通过 t.getToken() 获取 Bearer token（方案 A：ApiTransport 暴露 getToken）。
   */
  async upload(file: File): Promise<LoadResult> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE}/data/${DATA_ROUTES.UPLOAD}`;
    const token = this.t.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: formData,
    });

    const data: ApiResponse<LoadResult> = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || '上传失败');
    }
    return data.data as LoadResult;
  }

  /** 获取 ETL 数据版本（数据截止日 + 构建时间 + 内容指纹）。HomePage / SW 共用。 */
  version(): Promise<{ etlDate: string; buildTime: string; serverStartTime: string; contentVersion?: string }> {
    return this.t.request<{ etlDate: string; buildTime: string; serverStartTime: string; contentVersion?: string }>('/data/version');
  }
}
