export type WorkerRequestType = 'INIT' | 'LOAD_PARQUET' | 'QUERY';

export interface WorkerRequest<T = unknown> {
  id: string;
  type: WorkerRequestType;
  payload: T;
}

export interface WorkerResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

export interface LoadParquetPayload {
  file: File | string; // File object or URL
  tableName: string;
}

export interface QueryPayload {
  sql: string;
}

export type QueryResult = Uint8Array; // Arrow IPC buffer
