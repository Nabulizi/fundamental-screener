import type { ScanRow } from './types';
import { ProviderError, type QuoteProvider, type ProviderErrorCode } from './provider';

// Errors that justify trying the next provider. NOT_FOUND is deliberately
// excluded: if the primary says the symbol does not exist, the backup almost
// never will either, and trying it just wastes the backup's quota.
const FAILOVER_CODES: ProviderErrorCode[] = ['RATE_LIMITED', 'PROVIDER_ERROR'];

function shouldFailover(err: unknown): boolean {
  return err instanceof ProviderError && FAILOVER_CODES.includes(err.code);
}

/**
 * Compose providers into a single one that tries each in order. On a
 * rate-limit or provider error it falls through to the next provider; on
 * NOT_FOUND it stops immediately (the symbol genuinely isn't available). If
 * every provider fails, the last error is thrown.
 */
export function createFallbackProvider(providers: QuoteProvider[]): QuoteProvider {
  if (providers.length === 0) {
    throw new Error('createFallbackProvider requires at least one provider');
  }

  return {
    name: providers.map((p) => p.name).join('+'),
    async fetchCompany(ticker: string, signal?: AbortSignal): Promise<ScanRow> {
      let lastError: unknown;
      for (let i = 0; i < providers.length; i += 1) {
        try {
          return await providers[i].fetchCompany(ticker, signal);
        } catch (err) {
          lastError = err;
          const isLast = i === providers.length - 1;
          if (isLast || !shouldFailover(err)) throw err;
          // otherwise: fall through and try the next provider
        }
      }
      throw lastError;
    }
  };
}
