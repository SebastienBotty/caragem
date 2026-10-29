type SecurityEvent = {
  event: 'http' | 'google.callback' | 'socket.authentication' | 'server.error';
  outcome: 'success' | 'failure';
  route?: string;
  method?: string;
  status?: number;
  userId?: string;
  garageId?: string;
  requestId?: string;
  action?: string;
};

export function securityEvent({
  event,
  outcome,
  route,
  method,
  status,
  userId,
  garageId,
  requestId,
  action,
}: SecurityEvent) {
  // Explicit fields only: never serialize requests, errors, cookies or provider tokens.
  console.info(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      outcome,
      route,
      method,
      status,
      userId,
      garageId,
      requestId,
      action,
    }),
  );
}
