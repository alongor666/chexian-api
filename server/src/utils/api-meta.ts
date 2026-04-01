import type { Response } from 'express';
import { getRequestContext, getServerTimingValue } from './request-context.js';
import { dbEnv } from '../config/env.js';

export interface ApiResponseMeta {
  requestId: string;
  cacheHit: boolean;
  serverTiming: string;
  dataVersion: string;
}

export function buildResponseMeta(res?: Response): ApiResponseMeta {
  const ctx = getRequestContext();
  const serverTiming = getServerTimingValue();
  if (res && serverTiming) {
    res.setHeader('Server-Timing', serverTiming);
  }

  return {
    requestId: ctx?.requestId || 'unknown',
    cacheHit: Boolean(ctx?.cacheHit),
    serverTiming,
    dataVersion: dbEnv.DATA_VERSION,
  };
}
