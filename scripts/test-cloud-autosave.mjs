import { createClient } from '@supabase/supabase-js'

const { POCKETPLAN_SUPABASE_URL, POCKETPLAN_ANON_KEY, POCKETPLAN_SERVICE_KEY } = process.env
if (!POCKETPLAN_SUPABASE_URL || !POCKETPLAN_ANON_KEY || !POCKETPLAN_SERVICE_KEY) throw new Error('Missing Supabase test variables')

const admin = createClient(POCKETPLAN_SUPABASE_URL, POCKETPLAN_SERVICE_KEY, { auth: { persistSession: false } })
const testEmail = `pocketplan-test-${Date.now()}@example.com`
const testPassword = `PocketPlan-${crypto.randomUUID()}!`
let testUserId
let receiptPath

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: testEmail, password: testPassword, email_confirm: true })
  if (createError) throw createError
  testUserId = created.user.id

  const browser = createClient(POCKETPLAN_SUPABASE_URL, POCKETPLAN_ANON_KEY, { auth: { persistSession: false } })
  const { error: signInError } = await browser.auth.signInWithPassword({ email: testEmail, password: testPassword })
  if (signInError) throw signInError

  const { data: month, error: monthError } = await browser.from('budget_months').insert({ user_id: testUserId, month: '2026-08-01', salary: 3000 }).select().single()
  if (monthError) throw monthError

  const { data: salarySaved, error: salaryError } = await browser.from('budget_months').update({ salary: 3368 }).eq('id', month.id).select().single()
  if (salaryError) throw salaryError
  assert(Number(salarySaved.salary) === 3368, 'Salary autosave failed')

  const { data: allocation, error: insertError } = await browser.from('budget_allocations').insert({ user_id: testUserId, budget_month_id: month.id, category: 'Groceries', icon: '🛒', color: '#c27b5c', amount: 200, status: 'pending', label: 'Wala' }).select().single()
  if (insertError) throw insertError
  assert(allocation.label === 'Wala', 'Allocation label was not saved')

  const { data: adjustment, error: adjustmentError } = await browser.from('budget_allocations').insert({ user_id: testUserId, budget_month_id: month.id, category: 'Gov Support', amount: -47, status: 'pending', label: 'Bill' }).select().single()
  if (adjustmentError) throw adjustmentError
  assert(Number(adjustment.amount) === -47, 'Negative budget adjustment was not saved')

  const { data: edited, error: editError } = await browser.from('budget_allocations').update({ amount: 225, status: 'budgeted', label: 'Ali' }).eq('id', allocation.id).select().single()
  if (editError) throw editError
  assert(Number(edited.amount) === 225 && edited.status === 'budgeted' && edited.label === 'Ali', 'Allocation edit/status/label autosave failed')

  const { data: paid, error: paidError } = await browser.from('budget_allocations').update({ status: 'paid' }).eq('id', allocation.id).select().single()
  if (paidError) throw paidError
  assert(paid.status === 'paid', 'Paid status autosave failed')

  const { data: filtered, error: filterError } = await browser.from('budget_allocations').select('id').eq('budget_month_id', month.id).eq('label', 'Ali').eq('status', 'paid')
  if (filterError) throw filterError
  assert(filtered.some(item => item.id === allocation.id), 'Combined label/status filter failed')

  const { data: disposable, error: disposableError } = await browser.from('budget_allocations').insert({ user_id: testUserId, budget_month_id: month.id, category: 'Temporary', amount: 1, label: 'Bill' }).select().single()
  if (disposableError) throw disposableError
  const { error: deleteError } = await browser.from('budget_allocations').delete().eq('id', disposable.id)
  if (deleteError) throw deleteError
  const { count } = await browser.from('budget_allocations').select('id', { count: 'exact', head: true }).eq('id', disposable.id)
  assert(count === 0, 'Allocation delete autosave failed')

  receiptPath = `${testUserId}/${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await browser.storage
    .from('receipts')
    .upload(receiptPath, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError
  const { error: expenseError } = await browser.from('expenses').insert({
    user_id: testUserId,
    budget_month_id: month.id,
    merchant: 'Migration test',
    category: 'Other',
    amount: 1,
    spent_at: '2026-08-01',
    receipt_path: receiptPath,
  })
  if (expenseError) throw expenseError
  const { data: signedReceipt, error: signedReceiptError } = await browser.storage.from('receipts').createSignedUrl(receiptPath, 60)
  if (signedReceiptError) throw signedReceiptError
  assert(Boolean(signedReceipt.signedUrl), 'Private receipt signed URL failed')

  const { error: finalizeError } = await browser.from('budget_months').update({ is_finalized: true, finalized_at: new Date().toISOString() }).eq('id', month.id)
  if (finalizeError) throw finalizeError
  const { error: lockedEditError } = await browser.from('budget_allocations').update({ amount: 230 }).eq('id', allocation.id)
  assert(Boolean(lockedEditError), 'Finalized allocation accepted an edit')
  const { error: lockedInsertError } = await browser.from('budget_allocations').insert({ user_id: testUserId, budget_month_id: month.id, category: 'Late change', amount: 5, label: 'Bill' })
  assert(Boolean(lockedInsertError), 'Finalized month accepted a new allocation')

  console.log('Autosave E2E passed: salary, labels, Pending/Budgeted/Paid, filters, adjustment, delete, private receipt, and finalize lock.')
} finally {
  if (receiptPath) await admin.storage.from('receipts').remove([receiptPath])
  if (testUserId) await admin.auth.admin.deleteUser(testUserId)
}
