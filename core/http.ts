import helmet from 'helmet';
import type { Express, ErrorRequestHandler } from 'express';
export function security(app: Express, secure: boolean, formTargets: string[] | (() => string[]) = []) {
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({
    strictTransportSecurity: secure ? undefined : false,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"],
      frameAncestors: ["'none'"], formAction: ["'self'", ...(typeof formTargets === 'function' ? [() => formTargets().join(' ')] : formTargets)], upgradeInsecureRequests: secure ? [] : null,
    } },
    // Keep a concrete Origin on same-origin form POSTs. Callback responses use no-referrer.
    referrerPolicy: { policy: 'same-origin' },
  }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  // Error text may contain secrets; only expose a generic response.
  res.status(error?.status === 413 ? 413 : 400).json({ error: 'Solicitação inválida ou expirada. Reinicie o login no site de origem.' });
};
