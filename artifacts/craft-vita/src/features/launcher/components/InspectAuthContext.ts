import { createContext, useContext } from "react";
import type { InspectAuthPayload } from "@/services/tauriEvents";

const defaultAuth: InspectAuthPayload = { token: null, email: "—", userId: "—" };

export const InspectAuthContext = createContext<InspectAuthPayload>(defaultAuth);

export function useInspectAuth(): InspectAuthPayload {
  return useContext(InspectAuthContext);
}