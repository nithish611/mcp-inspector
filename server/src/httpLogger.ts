import { v4 as uuidv4 } from 'uuid';
import type { LogEntry } from './types.js';

type LogListener = (entry: LogEntry) => void;

interface PendingRequest {
  timestamp: string;
  method: string;
  params?: unknown;
  serverId?: string;
  serverName?: string;
  http?: LogEntry['http'];
}

interface LogOptions {
  serverId?: string;
  serverName?: string;
  http?: LogEntry['http'];
}

class HttpLogger {
  private logs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxLogs: number = 1000;
  private pendingRequests: Map<string | number, PendingRequest> = new Map();

  addListener(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(entry: LogEntry): void {
    this.logs.push(entry);
    
    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        console.error('Error in log listener:', error);
      }
    }
  }

  /**
   * Log a request - emits immediately and stores for response matching
   */
  logRequest(
    method: string,
    params?: unknown,
    requestId?: string | number,
    options?: LogOptions
  ): string {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Store for response matching if we have a requestId
    if (requestId !== undefined) {
      this.pendingRequests.set(requestId, {
        timestamp,
        method,
        params,
        serverId: options?.serverId,
        serverName: options?.serverName,
        http: options?.http,
      });
    }

    // Emit the request entry
    const entry: LogEntry = {
      id,
      timestamp,
      direction: 'request',
      method,
      params,
      requestId,
      serverId: options?.serverId,
      serverName: options?.serverName,
      http: options?.http,
    };

    this.emit(entry);
    return id;
  }

  /**
   * Log a response - emits separately, includes duration if matching request found
   */
  logResponse(
    result: unknown,
    requestId?: string | number,
    error?: unknown,
    options?: LogOptions
  ): string {
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    let duration: number | undefined;
    let method = 'unknown';
    let serverId: string | undefined;
    let serverName: string | undefined;
    let httpInfo: LogEntry['http'] | undefined;

    if (requestId !== undefined) {
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        duration = new Date(timestamp).getTime() - new Date(pending.timestamp).getTime();
        method = pending.method;
        serverId = pending.serverId;
        serverName = pending.serverName;
        // Merge HTTP info from request with response info
        httpInfo = {
          ...pending.http,
          ...options?.http,
        };
        this.pendingRequests.delete(requestId);
      }
    }

    // Use provided options if no pending request found
    if (!serverId && options?.serverId) {
      serverId = options.serverId;
    }
    if (!serverName && options?.serverName) {
      serverName = options.serverName;
    }
    if (!httpInfo && options?.http) {
      httpInfo = options.http;
    }

    const entry: LogEntry = {
      id,
      timestamp,
      direction: error ? 'error' : 'response',
      method,
      result: error ? undefined : result,
      error,
      duration,
      requestId,
      serverId,
      serverName,
      http: httpInfo,
    };

    this.emit(entry);
    return id;
  }

  logNotification(method: string, params?: unknown, options?: LogOptions): string {
    const id = uuidv4();
    const entry: LogEntry = {
      id,
      timestamp: new Date().toISOString(),
      direction: 'notification',
      method,
      params,
      serverId: options?.serverId,
      serverName: options?.serverName,
      http: options?.http,
    };

    this.emit(entry);
    return id;
  }

  logError(method: string, error: unknown, options?: LogOptions): string {
    const id = uuidv4();
    const entry: LogEntry = {
      id,
      timestamp: new Date().toISOString(),
      direction: 'error',
      method,
      error,
      serverId: options?.serverId,
      serverName: options?.serverName,
      http: options?.http,
    };

    this.emit(entry);
    return id;
  }

  /**
   * Log a complete HTTP request/response cycle
   */
  logHttpRequest(options: {
    method: string;
    url: string;
    requestHeaders?: Record<string, string>;
    requestBody?: unknown;
    responseStatusCode?: number;
    responseStatusText?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: unknown;
    error?: unknown;
    duration?: number;
    serverId?: string;
    serverName?: string;
  }): string {
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    // Determine if this is an error based on status code or error object
    const isError = options.error || (options.responseStatusCode && options.responseStatusCode >= 400);

    const entry: LogEntry = {
      id,
      timestamp,
      direction: isError ? 'error' : 'response',
      method: `HTTP ${options.method}`,
      params: options.requestBody,
      result: isError ? undefined : options.responseBody,
      error: options.error || (isError ? options.responseBody : undefined),
      duration: options.duration,
      serverId: options.serverId,
      serverName: options.serverName,
      http: {
        method: options.method,
        url: options.url,
        statusCode: options.responseStatusCode,
        statusText: options.responseStatusText,
        requestHeaders: options.requestHeaders,
        responseHeaders: options.responseHeaders,
        requestBody: typeof options.requestBody === 'string' 
          ? options.requestBody 
          : JSON.stringify(options.requestBody),
        responseBody: typeof options.responseBody === 'string'
          ? options.responseBody
          : JSON.stringify(options.responseBody),
      },
    };

    this.emit(entry);
    return id;
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by server ID
   */
  getLogsByServer(serverId: string): LogEntry[] {
    return this.logs.filter(log => log.serverId === serverId);
  }

  clearLogs(): void {
    this.logs = [];
    this.pendingRequests.clear();
  }

  /**
   * Clear logs for a specific server
   */
  clearLogsByServer(serverId: string): void {
    this.logs = this.logs.filter(log => log.serverId !== serverId);
  }

  getLogById(id: string): LogEntry | undefined {
    return this.logs.find(log => log.id === id);
  }
}

export const httpLogger = new HttpLogger();
export default httpLogger;
