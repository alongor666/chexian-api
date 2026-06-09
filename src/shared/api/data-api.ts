/**
 * 数据管理子客户端（ApiClient 神类拆分 Phase 2 · data 域）
 *
 * 挂载点：apiClient.data.*
 * 通过 ApiTransport 句柄复用单实例传输状态（不新建第二个 ApiClient）。
 *
 * 5 个端点：
 *   - files()      GET  /data/files        — 文件列表
 *   - load(fn)     POST /data/load/<fn>    — 加载数据文件
 *   - upload(f)    POST /data/upload       — multipart 上传（⚠️ 不走 JSON request()，
 *                                            直接 fetch + FormData；用 t.getToken() 取 Bearer）
 *   - remove(fn)   DEL  /data/<fn>         — 删除文件
 *   - version()    GET  /data/version      — ETL 数据版本
 *
 * upload 为本域唯一 multipart 方法，行为与原 ApiClient.uploadFile 逐字符等价：
 * 照搬 FormData + Authorization header 构造，移植 ApiResponse 反序列化与错误抛出。
 */

import { DATA_ROUTES } from './routes';
import { API_BASE, type ApiTransport } from './client-core';
import type { ApiResponse, FileInfo, LoadResult } from './types';

export class DataApi {
  constructor(private readonly t: ApiTransport) {}

  /** 获取文件列表 */
  files(): Promise<FileInfo[]> {
    return this.t.request<FileInfo[]>(`/data/${DATA_ROUTES.FILES}`);
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

  /** 删除文件 */
  remove(filename: string): Promise<void> {
    return this.t.request<void>(`/data/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  /** 获取 ETL 数据版本（数据截止日 + 构建时间）。HomePage / SW 共用。 */
  version(): Promise<{ etlDate: string; buildTime: string; serverStartTime: string }> {
    return this.t.request<{ etlDate: string; buildTime: string; serverStartTime: string }>('/data/version');
  }
}
