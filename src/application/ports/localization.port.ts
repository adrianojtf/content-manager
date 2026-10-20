export interface MoneyValue {
  readonly amount: number;
  readonly currency: string;
}

export interface LocalizationPort {
  getSupportedLocales(): readonly string[];
  translate(key: string, locale: string, parameters?: Readonly<Record<string, string | number>>): string;
  formatDate(value: Date, locale: string, timezone: string): string;
  formatNumber(value: number, locale: string): string;
  formatCurrency(value: MoneyValue, locale: string): string;
}
