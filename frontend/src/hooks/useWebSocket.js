import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context.jsx';

export function useWebSocket({ onHit, onStatus, onError }) {
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const { addToast } = useApp();

  const setDot = useCallback((on) => {
    // Signal via callback
    if (onStatus) onStatus(on ? 'live' : 'offline');
  }, [onStatus]);

  const connect = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setDot(true);
    ws.onclose = () => {
      setDot(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'status') {
          addToast(data.message, 'blue');
        } else if (data.type === 'error') {
          addToast(data.message, 'red');
          if (onError) onError(data.message);
        } else if (data.type === 'hit') {
          if (onHit) onHit(data);
        }
      } catch (err) {
        // ignore parse errors
      }
    };
  }, [setDot, addToast, onHit, onError]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);
}
