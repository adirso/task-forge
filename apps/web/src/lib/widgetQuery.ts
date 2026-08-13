import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface WidgetQuery<T> {
  data: T | null;
  error: string;
  loading: boolean;
}

export function startWidgetQuery<T>(): WidgetQuery<T> {
  return { data: null, error: "", loading: true };
}

export function resolveWidgetQuery<T>(data: T): WidgetQuery<T> {
  return { data, error: "", loading: false };
}

export function failWidgetQuery<T>(error: unknown): WidgetQuery<T> {
  return {
    data: null,
    error: error instanceof Error ? error.message : "Failed to load",
    loading: false,
  };
}

export const WidgetRefreshContext = createContext<(reload: (() => void) | null) => void>(() => undefined);

export function useWidgetQuery<T>(loader: () => Promise<T>, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const [state, setState] = useState<WidgetQuery<T>>(() => (
    enabled ? startWidgetQuery<T>() : { data: null, error: "", loading: false }
  ));
  const register = useContext(WidgetRefreshContext);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    if (!enabled) return;
    setState(startWidgetQuery<T>());
    loaderRef.current()
      .then((data) => setState(resolveWidgetQuery(data)))
      .catch((error: unknown) => setState(failWidgetQuery<T>(error)));
  }, [enabled]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;
    register(reload);
    return () => register(null);
  }, [enabled, register, reload]);

  return { ...state, reload };
}
