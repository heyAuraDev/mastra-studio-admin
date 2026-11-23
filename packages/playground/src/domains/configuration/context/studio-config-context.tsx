import { useEffect, useLayoutEffect, useState } from 'react';

import { useMastraInstanceStatus } from '../hooks/use-mastra-instance-status';
import type { StudioConfig } from '../types';
import { StudioConfigContext } from './studio-config-state';

export interface StudioConfigProviderProps {
  children: React.ReactNode;
  endpoint?: string;
  defaultApiPrefix?: string;
}

export const MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY = 'mastra-studio-config';
const AUTH_HEADER_PARAM = 'auth_header';
const AUTH_HEADER_NAME = 'Authorization';

const readUrlAuthHeader = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};

  const authHeader = new URL(window.location.href).searchParams.get(AUTH_HEADER_PARAM);
  return authHeader ? { [AUTH_HEADER_NAME]: authHeader } : {};
};

const removeUrlAuthHeader = () => {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (!url.searchParams.has(AUTH_HEADER_PARAM)) return;

  url.searchParams.delete(AUTH_HEADER_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

const getPersistentConfig = (config: StudioConfig): StudioConfig => {
  const { [AUTH_HEADER_NAME]: _authorization, ...headers } = config.headers;
  return { ...config, headers };
};

export const StudioConfigProvider = ({
  children,
  endpoint = 'http://localhost:4111',
  defaultApiPrefix = '/api',
}: StudioConfigProviderProps) => {
  const [urlHeaders] = useState<Record<string, string>>(readUrlAuthHeader);
  const hasUrlHeaders = Object.keys(urlHeaders).length > 0;
  const {
    data: instanceStatus,
    isLoading: isStatusLoading,
    error,
  } = useMastraInstanceStatus(endpoint, defaultApiPrefix, urlHeaders);
  const [config, setConfig] = useState<StudioConfig & { isLoading: boolean }>({
    baseUrl: '',
    headers: urlHeaders,
    apiPrefix: undefined,
    isLoading: true,
  });

  useEffect(() => {
    removeUrlAuthHeader();
  }, []);

  useLayoutEffect(() => {
    // Handle error case - stop loading but don't configure
    if (error && !isStatusLoading) {
      return setConfig({ baseUrl: '', headers: urlHeaders, apiPrefix: undefined, isLoading: false });
    }

    // Don't run the effect during the fetch request
    if (!instanceStatus?.status) return;

    const storedConfig = localStorage.getItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY);
    if (storedConfig) {
      const parsedConfig = JSON.parse(storedConfig);

      if (typeof parsedConfig === 'object' && parsedConfig !== null) {
        // Use stored apiPrefix if set, otherwise fall back to CLI default for back-compat
        const normalizedConfig = {
          ...parsedConfig,
          headers: { ...(parsedConfig.headers ?? {}), ...urlHeaders },
          apiPrefix: parsedConfig.apiPrefix ?? defaultApiPrefix,
        };
        if (hasUrlHeaders) {
          localStorage.setItem(
            MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY,
            JSON.stringify(getPersistentConfig(normalizedConfig)),
          );
        }
        return setConfig({ ...normalizedConfig, isLoading: false });
      }
    }

    if (instanceStatus.status === 'active') {
      const nextConfig = { baseUrl: endpoint, headers: urlHeaders, apiPrefix: defaultApiPrefix };
      if (hasUrlHeaders) {
        localStorage.setItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(getPersistentConfig(nextConfig)));
      }
      return setConfig({ ...nextConfig, isLoading: false });
    }

    return setConfig({ baseUrl: '', headers: urlHeaders, apiPrefix: undefined, isLoading: false });
  }, [instanceStatus, endpoint, defaultApiPrefix, isStatusLoading, error, urlHeaders, hasUrlHeaders]);

  const doSetConfig = (partialNewConfig: Partial<StudioConfig>) => {
    setConfig(prev => {
      const nextConfig = { ...prev, ...partialNewConfig };
      const persistentConfig = hasUrlHeaders ? getPersistentConfig(nextConfig) : nextConfig;
      localStorage.setItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(persistentConfig));
      return nextConfig;
    });
  };

  // [adex fork] Accept baseUrl/headers from the parent admin panel when Studio runs in an iframe.
  // The parent posts { type: 'localStorage-sync', baseUrl?, headers? }; the values are merged into
  // the current config and persisted so later loads reuse them.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      console.log('[StudioConfigProvider] message received:', data);
      if (!data || typeof data !== 'object') return;
      const payload = data as { type?: string; baseUrl?: unknown; headers?: unknown };

      if (payload.type !== 'localStorage-sync') return;

      const partial: Partial<StudioConfig> = {};
      if (typeof payload.baseUrl === 'string') partial.baseUrl = payload.baseUrl;
      if (payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)) {
        partial.headers = payload.headers as Record<string, string>;
      }

      if (Object.keys(partial).length) {
        setConfig(prev => {
          const nextConfig = { ...prev, ...partial };
          console.log('[StudioConfigProvider] nextConfig:', nextConfig);
          localStorage.setItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(nextConfig));
          return nextConfig;
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // attach once, never re-register

  return (
    <StudioConfigContext.Provider value={{ ...config, setConfig: doSetConfig }}>
      {children}
    </StudioConfigContext.Provider>
  );
};
