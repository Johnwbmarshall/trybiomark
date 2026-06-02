import { createServerFn } from "@tanstack/react-start";

export const getPaypalClientId = createServerFn({ method: "GET" }).handler(async () => {
  return { clientId: process.env.PAYPAL_CLIENT_ID ?? null };
});
