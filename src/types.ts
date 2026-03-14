export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string;
  isSubscription: boolean;
  uid: string;
  createdAt: any; // Firestore Timestamp
}

export interface BurnData {
  monthlyRevenue: number;
  cashBalance: number;
  expenses: Expense[];
}

export interface AnalysisResult {
  runwayMonths: number;
  monthlyBurn: number;
  suggestions: string[];
  insights: string;
}
