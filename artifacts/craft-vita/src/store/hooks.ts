import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./store";

/** Typed dispatch — includes thunk middleware typing */
export const useAppDispatch = () => useDispatch<AppDispatch>();

/** Typed selector */
export const useAppSelector = <T>(selector: (state: RootState) => T): T =>
  useSelector<RootState, T>(selector);
