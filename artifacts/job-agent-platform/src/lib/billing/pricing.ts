export type Currency = "INR" | "USD" | "EUR";

type Plan = {
  id: "starter" | "pro" | "accelerator";
  name: string;
  credits: number;
  monthly: Record<Currency, number>;
};

export const plans: readonly Plan[] = [
  { id: "starter", name: "Starter", credits: 40, monthly: { INR: 149900, USD: 1900, EUR: 1799 } },
  { id: "pro", name: "Pro", credits: 120, monthly: { INR: 329900, USD: 3900, EUR: 3699 } },
  { id: "accelerator", name: "Accelerator", credits: 300, monthly: { INR: 599900, USD: 6900, EUR: 6499 } },
] as const;

const locales: Record<Currency, string> = { INR: "en-IN", USD: "en-US", EUR: "en-IE" };

export function formatMoney(minorUnits: number, currency: Currency): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0) throw new Error("Amount must be non-negative integer minor units");
  return new Intl.NumberFormat(locales[currency], { style: "currency", currency }).format(minorUnits / 100);
}
