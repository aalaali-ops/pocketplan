export type BudgetStatus = 'pending' | 'budgeted' | 'paid'
export type BudgetLabel = 'Ali' | 'Wala' | 'Bill'
export type BudgetMonth = { id: string; month: string; salary: number; is_finalized: boolean }
export type Allocation = { id: string; category: string; icon: string; color: string; amount: number; status: BudgetStatus; label: BudgetLabel }
export type Expense = { id: string; merchant: string; category: string; amount: number; spent_at: string; note?: string; receipt_url?: string }
