/**
 * GST computation — the SINGLE source for Indian tax on invoices.
 *
 * Every invoice (credit-pack order, subscription charge) is produced by
 * computeGst below; routes persist exactly these numbers, so the charged amount
 * and the printed invoice can never disagree. Pure module (no DB, no env reads
 * at call time except the exported defaults passed in by the caller).
 *
 * Rules implemented:
 *  - Prices are GST-inclusive by default (Indian listed prices). The taxable
 *    value and tax component are extracted from the charged total so the buyer
 *    still pays the advertised price. Exclusive mode is supported for B2B.
 *  - Intra-state supply (supplier state == place of supply, determined by the
 *    buyer's GSTIN first two digits when present) splits tax into CGST + SGST.
 *  - Inter-state supply charges IGST.
 *  - GSTIN is validated including the mod-36 checksum. An invalid GSTIN is
 *    rejected (never silently ignored), because a wrong GSTIN on an invoice
 *    cannot be corrected after the fact.
 */

export const GST_RATE_BPS_DEFAULT = 1800; // 18% (9% CGST + 9% SGST)
export const GST_SUPPLIER_STATE_DEFAULT = "27"; // Maharashtra
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type GstType = "CGST_SGST" | "IGST" | "NONE";

export class RazorpayGstError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayGstError";
  }
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstinCharValue(char: string): number {
  const index = GSTIN_CHARS.indexOf(char);
  return index >= 0 ? index : -1;
}

function gstinChecksum(gstin: string): string {
  let sum = 0;
  for (let position = 0; position < 14; position++) {
    const value = gstinCharValue(gstin[position]!);
    if (value < 0) return "";
    const factor = position % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const checksumValue = (36 - (sum % 36)) % 36;
  return GSTIN_CHARS[checksumValue]!;
}

export function isValidGstin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const gstin = value.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return false;
  const expected = gstinChecksum(gstin);
  return expected.length === 1 && expected === gstin[14];
}

/** Normalise + validate a GSTIN; throws when structurally/checksum invalid. */
export function assertValidGstin(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RazorpayGstError("GSTIN must be a non-empty string");
  }
  const gstin = value.trim().toUpperCase();
  if (!isValidGstin(gstin)) {
    throw new RazorpayGstError("Invalid GSTIN (format or checksum failed): " + gstin);
  }
  return gstin;
}

export function gstStateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

export interface GstBreakdown {
  /** Amount actually charged to the buyer (minor units). */
  totalMinor: number;
  /** Taxable value (total minus GST when inclusive). */
  subtotalMinor: number;
  taxMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxType: GstType;
  taxRateBps: number;
  taxInclusive: boolean;
  gstin: string | null;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
}

export interface ComputeGstInput {
  amountMinor: number;
  /** When true (default) amountMinor already includes GST. */
  taxInclusive?: boolean;
  /** 1800 = 18%. */
  taxRateBps?: number;
  supplierStateCode?: string;
  /** Buyer state (2 digits). Ignored/defaulted from GSTIN when GSTIN present. */
  placeOfSupplyStateCode?: string;
  /** Validated buyer GSTIN; invalid values throw. */
  gstin?: string | null;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RazorpayGstError(label + " must be a non-negative integer in minor units");
  }
}

/**
 * Compute the GST breakdown for one invoice line/total.
 * Pure + deterministic: the same inputs always produce the same invoice.
 */
export function computeGst(input: ComputeGstInput): GstBreakdown {
  assertNonNegativeInteger(input.amountMinor, "amountMinor");
  const taxInclusive = input.taxInclusive !== false;
  const rateBps = input.taxRateBps ?? GST_RATE_BPS_DEFAULT;
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 5000) {
    throw new RazorpayGstError("taxRateBps must be an integer between 0 and 5000");
  }
  const supplierStateCode = (input.supplierStateCode ?? GST_SUPPLIER_STATE_DEFAULT).padStart(2, "0");

  let gstin: string | null = null;
  let placeOfSupply = (input.placeOfSupplyStateCode ?? supplierStateCode).padStart(2, "0");
  if (input.gstin !== undefined && input.gstin !== null && input.gstin.trim().length > 0) {
    gstin = assertValidGstin(input.gstin);
    placeOfSupply = gstStateCodeFromGstin(gstin);
  }

  if (rateBps === 0) {
    return {
      totalMinor: input.amountMinor,
      subtotalMinor: input.amountMinor,
      taxMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      taxType: "NONE",
      taxRateBps: 0,
      taxInclusive,
      gstin,
      supplierStateCode,
      placeOfSupplyStateCode: placeOfSupply,
    };
  }

  let subtotalMinor: number;
  let taxMinor: number;
  let totalMinor: number;
  if (taxInclusive) {
    totalMinor = input.amountMinor;
    // taxable = total * 10000 / (10000 + rate), rounded to the nearest paisa.
    subtotalMinor = Math.round((totalMinor * 10000) / (10000 + rateBps));
    taxMinor = totalMinor - subtotalMinor;
  } else {
    subtotalMinor = input.amountMinor;
    taxMinor = Math.round((subtotalMinor * rateBps) / 10000);
    totalMinor = subtotalMinor + taxMinor;
  }

  const intraState = supplierStateCode === placeOfSupply;
  const cgstMinor = intraState ? Math.floor(taxMinor / 2) : 0;
  const sgstMinor = intraState ? taxMinor - cgstMinor : 0;
  const igstMinor = intraState ? 0 : taxMinor;

  return {
    totalMinor,
    subtotalMinor,
    taxMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    taxType: intraState ? "CGST_SGST" : "IGST",
    taxRateBps: rateBps,
    taxInclusive,
    gstin,
    supplierStateCode,
    placeOfSupplyStateCode: placeOfSupply,
  };
}

/** Supplier state configured for this deployment. */
export function configuredSupplierStateCode(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env["RAZORPAY_GST_SUPPLIER_STATE"];
  const state = typeof raw === "string" ? raw.trim() : "";
  return state.length > 0 ? state.padStart(2, "0") : GST_SUPPLIER_STATE_DEFAULT;
}

/** GST rate configured for this deployment (basis points). */
export function configuredGstRateBps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["RAZORPAY_GST_RATE_BPS"];
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5000 ? parsed : GST_RATE_BPS_DEFAULT;
}

/** Whether listed prices include GST (default true; set RAZORPAY_GST_INCLUSIVE=0 for B2B exclusive). */
export function configuredGstInclusive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["RAZORPAY_GST_INCLUSIVE"] !== "0";
}
