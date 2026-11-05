import type { PaymentRequest } from '../../api/types';
/** Future SkyMP-Economy adapter. Economy MUST deduplicate key durably, including ambiguous retries. */
export interface EconomyAdapterV1 {
  readonly apiVersion: 1;
  request(request: Readonly<PaymentRequest & { characterId: string; owner: string; idempotencyKey: string }>):
    Promise<{ status: 'pending' | 'settled'; reference?: string }>;
}
