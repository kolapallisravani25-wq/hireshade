import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchCreditBrackets,
  type CreditBracket,
} from "@/store/pricingSlice";

export type { CreditBracket } from "@/store/pricingSlice";

interface UseCreditBracketsReturn {
  brackets: CreditBracket[];
  isLoading: boolean;
}

export function useCreditBrackets(): UseCreditBracketsReturn {
  const dispatch = useAppDispatch();
  const brackets = useAppSelector((state) => state.pricing.creditBrackets);
  const status = useAppSelector((state) => state.pricing.status);

  useEffect(() => {
    if (status === "idle") {
      dispatch(fetchCreditBrackets());
    }
  }, [dispatch, status]);

  return { brackets, isLoading: status === "idle" || status === "loading" };
}
