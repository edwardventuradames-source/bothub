import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth.store.js';

export function createAuthenticatedSocket(): Socket | null {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    return null;
  }
  const wsUrl = import.meta.env.VITE_WS_URL || undefined;
  return io(wsUrl, {
    auth: {
      token: accessToken
    },
    transports: ['websocket', 'polling']
  });
}
