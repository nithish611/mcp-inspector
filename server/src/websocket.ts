import type { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import httpLogger from './httpLogger.js';
import type { LogEntry } from './types.js';

interface WSMessage {
  type: string;
  payload?: unknown;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private unsubscribeLogger: (() => void) | null = null;

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      // Send existing logs to new client
      const existingLogs = httpLogger.getLogs();
      if (existingLogs.length > 0) {
        this.sendToClient(ws, {
          type: 'logs:initial',
          payload: existingLogs,
        });
      }

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as WSMessage;
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });
    });

    // Subscribe to log events
    this.unsubscribeLogger = httpLogger.addListener((entry: LogEntry) => {
      this.broadcast({
        type: 'log:new',
        payload: entry,
      });
    });

    console.log('WebSocket server initialized');
  }

  private handleMessage(ws: WebSocket, message: WSMessage): void {
    switch (message.type) {
      case 'logs:clear':
        httpLogger.clearLogs();
        this.broadcast({ type: 'logs:cleared' });
        break;
      case 'logs:get':
        this.sendToClient(ws, {
          type: 'logs:initial',
          payload: httpLogger.getLogs(),
        });
        break;
      case 'ping':
        this.sendToClient(ws, { type: 'pong' });
        break;
      default:
        console.warn('Unknown WebSocket message type:', message.type);
    }
  }

  private sendToClient(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  broadcastConnectionStatus(status: unknown, serverId?: string): void {
    this.broadcast({
      type: 'connection:status',
      payload: { status, serverId },
    });
  }

  close(): void {
    if (this.unsubscribeLogger) {
      this.unsubscribeLogger();
      this.unsubscribeLogger = null;
    }

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

export const wsManager = new WebSocketManager();
export default wsManager;
