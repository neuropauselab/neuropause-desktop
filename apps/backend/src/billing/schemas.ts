import { z } from 'zod';

export const CheckoutBody = z.object({
  plan: z.enum(['trial', 'starter', 'professional', 'enterprise']),
  seats: z.coerce.number().int().min(1).max(1000).optional(),
});
