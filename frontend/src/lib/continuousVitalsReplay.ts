const NativeWebSocket = window.WebSocket;

const MIN_RECONNECT_INTERVAL_MS = 13_000;
const REPLAY_PATH_FRAGMENT = '/triage/stream';

export function isReplayCompletedPayload(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  try {
    const parsed = JSON.parse(data) as { status?: unknown };
    return parsed.status === 'completed';
  } catch {
    return false;
  }
}

class ContinuousVitalsReplayWebSocket extends EventTarget {
  static readonly CONNECTING = NativeWebSocket.CONNECTING;
  static readonly OPEN = NativeWebSocket.OPEN;
  static readonly CLOSING = NativeWebSocket.CLOSING;
  static readonly CLOSED = NativeWebSocket.CLOSED;

  readonly CONNECTING = NativeWebSocket.CONNECTING;
  readonly OPEN = NativeWebSocket.OPEN;
  readonly CLOSING = NativeWebSocket.CLOSING;
  readonly CLOSED = NativeWebSocket.CLOSED;

  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;

  private socket: WebSocket;
  private readonly targetUrl: string | URL;
  private readonly protocols?: string | string[];
  private readonly continuousReplay: boolean;
  private authFrame: string | ArrayBufferLike | Blob | ArrayBufferView | null = null;
  private manuallyClosed = false;
  private restarting = false;
  private openedOnce = false;
  private reconnectTimer: number | null = null;
  private lastConnectedAt = 0;
  private _binaryType: BinaryType = 'blob';

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.targetUrl = url;
    this.protocols = protocols;
    this.continuousReplay = String(url).includes(REPLAY_PATH_FRAGMENT);
    this.socket = this.createSocket();
  }

  get url(): string { return this.socket.url; }
  get readyState(): number { return this.socket.readyState; }
  get bufferedAmount(): number { return this.socket.bufferedAmount; }
  get extensions(): string { return this.socket.extensions; }
  get protocol(): string { return this.socket.protocol; }

  get binaryType(): BinaryType { return this._binaryType; }
  set binaryType(value: BinaryType) {
    this._binaryType = value;
    this.socket.binaryType = value;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.continuousReplay && typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as { type?: unknown };
        if (parsed.type === 'auth') this.authFrame = data;
      } catch {
        // Normal non-JSON WebSocket frames are still forwarded unchanged.
      }
    }
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.manuallyClosed = true;
    this.restarting = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket.close(code, reason);
  }

  private createSocket(): WebSocket {
    const socket = this.protocols === undefined
      ? new NativeWebSocket(this.targetUrl)
      : new NativeWebSocket(this.targetUrl, this.protocols);
    socket.binaryType = this._binaryType;

    socket.onopen = (event) => {
      this.lastConnectedAt = Date.now();

      if (this.restarting && this.authFrame !== null) {
        this.restarting = false;
        socket.send(this.authFrame);
        return;
      }

      if (!this.openedOnce) {
        this.openedOnce = true;
        this.onopen?.call(this as unknown as WebSocket, event);
        this.dispatchEvent(event);
      }
    };

    socket.onmessage = (event) => {
      if (this.continuousReplay && isReplayCompletedPayload(event.data)) {
        this.restartAfterReplay();
        return;
      }

      this.onmessage?.call(this as unknown as WebSocket, event);
      this.dispatchEvent(event);
    };

    socket.onerror = (event) => {
      if (this.restarting) return;
      this.onerror?.call(this as unknown as WebSocket, event);
      this.dispatchEvent(event);
    };

    socket.onclose = (event) => {
      if (this.restarting && !this.manuallyClosed) return;
      this.onclose?.call(this as unknown as WebSocket, event);
      this.dispatchEvent(event);
    };

    return socket;
  }

  private restartAfterReplay(): void {
    if (this.manuallyClosed || this.authFrame === null || this.restarting) return;

    this.restarting = true;
    try {
      this.socket.close(1000, 'replay-cycle-complete');
    } catch {
      // Reconnect below even if the previous socket is already closed.
    }

    const elapsed = Date.now() - this.lastConnectedAt;
    const delay = Math.max(250, MIN_RECONNECT_INTERVAL_MS - elapsed);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.manuallyClosed) return;
      this.socket = this.createSocket();
    }, delay);
  }
}

if (!(window.WebSocket as unknown as { __mediMatrixContinuousReplay?: boolean }).__mediMatrixContinuousReplay) {
  const Replacement = ContinuousVitalsReplayWebSocket as unknown as typeof WebSocket & {
    __mediMatrixContinuousReplay?: boolean;
  };
  Replacement.__mediMatrixContinuousReplay = true;
  window.WebSocket = Replacement;
}
