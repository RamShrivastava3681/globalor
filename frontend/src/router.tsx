import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cache data for 5 minutes — prevents re-fetch on navigation and
        // makes back-and-forth between workbenches feel instant.
        staleTime: 5 * 60 * 1000,
        // Keep unused cache for 30 minutes, so revisiting a page within a
        // session renders instantly from cache while a background refresh runs.
        gcTime: 30 * 60 * 1000,
        // Don't refetch on window focus by default (dashboard sets its own)
        refetchOnWindowFocus: false,
        // Don't refetch on mount if data is still fresh
        refetchOnMount: true,
        // Retry failed requests once
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
