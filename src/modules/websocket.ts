import WebSocket from 'ws';
import { MarketUpdateEvent, WsEventMap, WsEventName } from '../types/websocket';

type Handler<K extends WsEventName> = (payload: WsEventMap[K]) => void;

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private url = '';
  private reconnectOnce = true;
  private readonly handlers = new Map<WsEventName, Set<Handler<WsEventName>>>();

  connect(url: string): void {
    this.url = url;
    this.reconnectOnce = true;
    this.open();
  }

  disconnect(): void {
    this.reconnectOnce = false;
    this.socket?.close();
    this.socket = null;
  }

  subscribe(marketIds: string[]): void {
    this.send({ action: 'set_subscriptions', marketIds });
  }

  ping(): void {
    this.send({ action: 'ping' });
  }

  on<K extends WsEventName>(event: K, handler: Handler<K>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<WsEventName>);
  }

  off<K extends WsEventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<WsEventName>);
  }

  private emit<K extends WsEventName>(event: K, payload: WsEventMap[K]): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }

  private send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.on('open', () => this.emit('open', undefined as void));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { action?: string; type?: string };
        if (msg.action === 'pong') {
          this.emit('pong', undefined as void);
        } else if (msg.type === 'market_update') {
          this.emit('market_update', msg as MarketUpdateEvent);
        }
      } catch {}
    });

    ws.on('close', () => {
      this.emit('close', undefined as void);
      if (this.reconnectOnce) {
        this.reconnectOnce = false;
        setTimeout(() => this.open(), 2000);
      }
    });

    ws.on('error', (err) => this.emit('error', err));
  }
}
