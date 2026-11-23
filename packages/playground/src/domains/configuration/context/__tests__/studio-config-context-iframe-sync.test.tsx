// @vitest-environment jsdom
// [adex fork] Studio runs inside the adex admin panel iframe; the parent pushes baseUrl/headers via postMessage.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY, StudioConfigProvider } from '../studio-config-context';
import { useStudioConfig } from '../studio-config-state';
import { authDisabledCapabilities } from './fixtures/capabilities';
import { server } from '@/test/msw-server';

const BASE_URL = 'http://localhost:4111';

const ConfigProbe = () => {
  const config = useStudioConfig();
  return <pre data-testid="config">{JSON.stringify(config)}</pre>;
};

const renderProvider = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <StudioConfigProvider endpoint={BASE_URL}>
        <ConfigProbe />
      </StudioConfigProvider>
    </QueryClientProvider>,
  );
};

const readConfig = () => JSON.parse(screen.getByTestId('config').textContent ?? '{}');

const postParentMessage = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('StudioConfigProvider iframe sync', () => {
  it('updates and persists config from a localStorage-sync message', async () => {
    server.use(http.get(`${BASE_URL}/api/auth/capabilities`, () => HttpResponse.json(authDisabledCapabilities)));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderProvider();

    await waitFor(() => expect(readConfig().isLoading).toBe(false));

    postParentMessage({
      type: 'localStorage-sync',
      baseUrl: 'https://custom.mastra.test',
      headers: { Authorization: 'Bearer iframe-token' },
    });

    await waitFor(() =>
      expect(readConfig()).toMatchObject({
        baseUrl: 'https://custom.mastra.test',
        headers: { Authorization: 'Bearer iframe-token' },
        apiPrefix: '/api',
        isLoading: false,
      }),
    );

    expect(JSON.parse(window.localStorage.getItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY) ?? '{}')).toMatchObject({
      baseUrl: 'https://custom.mastra.test',
      headers: { Authorization: 'Bearer iframe-token' },
      apiPrefix: '/api',
    });
  });

  it('ignores messages of other types', async () => {
    server.use(http.get(`${BASE_URL}/api/auth/capabilities`, () => HttpResponse.json(authDisabledCapabilities)));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    renderProvider();

    await waitFor(() => expect(readConfig().isLoading).toBe(false));

    postParentMessage({ type: 'something-else', baseUrl: 'https://ignored.test', headers: { Authorization: 'x' } });

    expect(readConfig()).toMatchObject({ baseUrl: BASE_URL, headers: {} });
    expect(window.localStorage.getItem(MASTRA_STUDIO_CONFIG_LOCAL_STORAGE_KEY)).toBeNull();
  });
});
