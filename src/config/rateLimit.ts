import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 300, // 300 req/min per IP (tune per plan)
  standardHeaders: true,
  legacyHeaders: false
});

