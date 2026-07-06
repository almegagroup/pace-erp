import { QueryClient } from "@tanstack/react-query";

export const DEFAULT_STALE_TIME_MS = 60 * 1000;
export const DEFAULT_GC_TIME_MS = 10 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      gcTime: DEFAULT_GC_TIME_MS,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
  },
});
