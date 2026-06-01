import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import type { AuthState } from "./routes/__root";

const defaultAuth: AuthState = {
  isAuthenticated: false,
  userId: null,
  email: null,
};

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient, auth: defaultAuth },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
