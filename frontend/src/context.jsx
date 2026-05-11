import { createContext, useContext, useState, useRef, useCallback } from 'react';

export const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [cfg, setCfg] = useState({});
  const [hits, setHits] = useState([]);
  const hitIds = useRef(new Set());
  const [listenerStatus, setListenerStatus] = useState({});
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, color = 'gray') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, color }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 200);
    }, 3200);
  }, []);

  return (
    <AppContext.Provider value={{
      cfg, setCfg,
      hits, setHits,
      hitIds,
      listenerStatus, setListenerStatus,
      toasts, addToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
