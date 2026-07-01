


export type LedgerType = 'DEBIT' | 'PURCHASE' | 'REFUND' | 'EARN';


export interface GrantCreditRow {
  
  userId: string;
  
  name: string | null;
  
  email: string;
  
  createdAt: string;
  
  purchasedCredits: string;
  
  earnedCredits: string;
  
  heldCredits: string;
  
  totalAvailable: string;
  
  lastUpdated: string | null;
}


export interface AssignCreditInput {
  userId: string;
  amount: number;
}


export interface AssignCreditResult {
  success: boolean;
  newEarnedCredits: string;
  newTotalAvailable: string;
  ledgerEntryId: string;
}


export interface GrantCreditFetchResult {
  records: GrantCreditRow[];
  total: number;
}
