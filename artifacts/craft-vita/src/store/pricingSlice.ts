import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { ENDPOINTS } from "@/lib/endpoints";
import { getAuthHeaders } from "@/lib/globalAuth";

export interface CreditBracket {
  id: string;
  bracketMinutes: number;
  creditsFull: string;
  creditsHalf: string;
  creditsPerMinute: string;
  graceZoneMinutes: number;
  isActive: boolean;
}

type PricingStatus = "idle" | "loading" | "succeeded" | "failed";

interface PricingState {
  creditBrackets: CreditBracket[];
  status: PricingStatus;
  error: string | null;
}

const initialState: PricingState = {
  creditBrackets: [],
  status: "idle",
  error: null,
};

function isCreditBracket(value: unknown): value is CreditBracket {
  if (!value || typeof value !== "object") return false;
  const bracket = value as Partial<CreditBracket>;
  return (
    typeof bracket.id === "string" &&
    typeof bracket.bracketMinutes === "number" &&
    typeof bracket.creditsFull === "string" &&
    typeof bracket.creditsHalf === "string" &&
    (typeof bracket.creditsPerMinute === "string" ||
      typeof bracket.creditsPerMinute === "number") &&
    typeof bracket.graceZoneMinutes === "number" &&
    typeof bracket.isActive === "boolean"
  );
}

function normalizeCreditBracket(bracket: CreditBracket): CreditBracket {
  return {
    ...bracket,
    creditsPerMinute: String(bracket.creditsPerMinute),
  };
}

function parseCreditBracketsPayload(payload: unknown): CreditBracket[] {
  const root = payload as { data?: unknown } | CreditBracket[] | null;
  const rows = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : [];

  return rows
    .filter(isCreditBracket)
    .filter((bracket) => bracket.isActive)
    .map(normalizeCreditBracket)
    .sort((left, right) => left.bracketMinutes - right.bracketMinutes);
}

export const fetchCreditBrackets = createAsyncThunk<
  CreditBracket[],
  void,
  { rejectValue: string }
>("pricing/fetchCreditBrackets", async (_arg, { rejectWithValue }) => {
  try {
    const response = await fetch(ENDPOINTS.creditsBrackets(), {
      headers: await getAuthHeaders(),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return rejectWithValue(
        `Failed to load credit brackets: ${response.status} ${response.statusText}`,
      );
    }

    return parseCreditBracketsPayload(payload);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error
        ? error.message
        : "Failed to load credit brackets",
    );
  }
});

const pricingSlice = createSlice({
  name: "pricing",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCreditBrackets.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(
        fetchCreditBrackets.fulfilled,
        (state, action: PayloadAction<CreditBracket[]>) => {
          state.status = "succeeded";
          state.creditBrackets = action.payload;
          state.error = null;
        },
      )
      .addCase(fetchCreditBrackets.rejected, (state, action) => {
        state.status = "failed";
        state.error =
          action.payload ||
          action.error.message ||
          "Failed to load credit brackets";
      });
  },
});

export default pricingSlice.reducer;
