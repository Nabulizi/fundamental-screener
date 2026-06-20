import type { ScanRow } from './types';

export type ProviderErrorCode = 'NOT_FOUND' | 'RATE_LIMITED' | 'PROVIDER_ERROR';

export class ProviderError extends Error {
  code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

/**
 * Provider-agnostic contract. Swapping Finnhub for another data source means
 * implementing this single interface; nothing else in the app depends on the
 * provider's wire format.
 */
export interface QuoteProvider {
  readonly name: string;
  /** Resolve one ticker to a normalized row, or throw ProviderError. */
  fetchCompany(ticker: string, signal?: AbortSignal): Promise<ScanRow>;
}
