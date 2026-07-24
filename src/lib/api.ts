import { supabase } from './supabase'
import type { Allocation, Expense } from '../types'

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export async function loadMonth(userId: string, month: string) {
  const { data: budgetMonth, error } = await client().from('budget_months').select('*').eq('user_id', userId).eq('month', month).maybeSingle()
  if (error) throw error
  if (!budgetMonth) return null

  const [{ data: allocationRows, error: allocationError }, { data: expenseRows, error: expenseError }] = await Promise.all([
    client().from('budget_allocations').select('*').eq('budget_month_id', budgetMonth.id).order('created_at'),
    client().from('expenses').select('*').eq('budget_month_id', budgetMonth.id).order('spent_at', { ascending: false }),
  ])
  if (allocationError) throw allocationError
  if (expenseError) throw expenseError

  const expenses = await Promise.all((expenseRows || []).map(async row => {
    if (!row.receipt_path) return row as Expense
    const { data } = await client().storage.from('receipts').createSignedUrl(row.receipt_path, 3600)
    return { ...row, receipt_url: data?.signedUrl } as Expense
  }))
  return {
    budgetMonth,
    allocations: (allocationRows || []).map(row => ({ ...row, amount: Number(row.amount) })) as Allocation[],
    expenses: expenses.map(row => ({ ...row, amount: Number(row.amount) })),
  }
}

export async function ensureMonth(userId: string, month: string, salary = 0) {
  const { error } = await client().from('budget_months').upsert(
    { user_id: userId, month, salary },
    { onConflict: 'user_id,month', ignoreDuplicates: true },
  )
  if (error) throw error
  const { data, error: readError } = await client().from('budget_months').select('*').eq('user_id', userId).eq('month', month).single()
  if (readError) throw readError
  return data
}

export async function updateMonthSalary(id: string, salary: number) {
  const { data, error } = await client().from('budget_months').update({ salary }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function finalizeBudgetMonth(id: string) {
  const { data, error } = await client().from('budget_months').update({ is_finalized: true, finalized_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function insertAllocation(userId: string, budgetMonthId: string, allocation: Allocation) {
  const { data, error } = await client().from('budget_allocations').insert({
    id: allocation.id,
    user_id: userId,
    budget_month_id: budgetMonthId,
    category: allocation.category,
    icon: allocation.icon,
    color: allocation.color,
    amount: allocation.amount,
    status: allocation.status,
    label: allocation.label,
  }).select().single()
  if (error) throw error
  return { ...data, amount: Number(data.amount) } as Allocation
}

export async function updateAllocation(allocation: Allocation) {
  const { data, error } = await client().from('budget_allocations').update({
    category: allocation.category,
    icon: allocation.icon,
    color: allocation.color,
    amount: allocation.amount,
    status: allocation.status,
    label: allocation.label,
  }).eq('id', allocation.id).select().single()
  if (error) throw error
  return { ...data, amount: Number(data.amount) } as Allocation
}

export async function removeAllocation(id: string) {
  const { error } = await client().from('budget_allocations').delete().eq('id', id)
  if (error) throw error
}

export async function copyPlanToMonth(userId: string, month: string, salary: number, allocations: Allocation[]) {
  const destination = await ensureMonth(userId, month, salary)
  const { count, error: countError } = await client().from('budget_allocations').select('id', { count: 'exact', head: true }).eq('budget_month_id', destination.id)
  if (countError) throw countError
  if (!count && allocations.length) {
    const { error } = await client().from('budget_allocations').insert(allocations.map(item => ({
      user_id: userId,
      budget_month_id: destination.id,
      category: item.category,
      icon: item.icon,
      color: item.color,
      amount: item.amount,
      status: 'pending',
      label: item.label,
    })))
    if (error) throw error
  }
  return destination
}

export async function saveExpense(userId: string, budgetMonthId: string, expense: Expense, receipt?: File | null) {
  let receiptPath: string | null = null
  if (receipt) receiptPath = await uploadReceipt(userId, expense.id, receipt)
  const { data, error } = await client().from('expenses').insert({
    id: expense.id,
    user_id: userId,
    budget_month_id: budgetMonthId,
    merchant: expense.merchant,
    category: expense.category,
    amount: expense.amount,
    spent_at: expense.spent_at,
    note: expense.note,
    receipt_path: receiptPath,
  }).select().single()
  if (error) throw error
  return { ...data, amount: Number(data.amount), receipt_url: receipt ? URL.createObjectURL(receipt) : undefined } as Expense
}

export async function uploadReceipt(userId: string, expenseId: string, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${userId}/${expenseId}.${extension}`
  const { error } = await client().storage.from('receipts').upload(path, file, { upsert: true })
  if (error) throw error
  return path
}
