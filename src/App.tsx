import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { BarChart3, CalendarDays, Camera, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleDollarSign, Home, LockKeyhole, Pencil, Plus, ReceiptText, Settings, Sparkles, Target, Trash2, TrendingDown, WalletCards, X } from 'lucide-react'
import { addMonths, format, parse, parseISO } from 'date-fns'
import { categoryOptions, monthlyTrend } from './data'
import type { Allocation, BudgetStatus, Expense } from './types'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { copyPlanToMonth, ensureMonth, finalizeBudgetMonth, insertAllocation, loadMonth, removeAllocation, saveExpense, updateAllocation, updateMonthSalary } from './lib/api'

type Tab = 'overview' | 'budget' | 'expenses' | 'insights'
const JULY_KEY = '2026-07'
const initialMonth = () => parse(localStorage.getItem('pocketplan-active-month') || JULY_KEY, 'yyyy-MM', new Date())
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const budgetLabels = ['Ali', 'Wala', 'Bill'] as const
const inferredLabel = (category: string): Allocation['label'] => /\bwala\b/i.test(category) ? 'Wala' : /\bali\b/i.test(category) ? 'Ali' : 'Bill'

const money = (value: number) => new Intl.NumberFormat('en-BH', { style: 'currency', currency: 'BHD', minimumFractionDigits: value % 1 ? 2 : 0 }).format(value)

function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [month, setMonth] = useState(initialMonth)
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [budgetMonthId, setBudgetMonthId] = useState('')
  const [salary, setSalary] = useState(0)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [finalized, setFinalized] = useState(false)
  const [salaryDirty, setSalaryDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [modal, setModal] = useState<'budget' | 'expense' | null>(null)
  const [editingBudget, setEditingBudget] = useState<Allocation | null>(null)
  const [deletingBudget, setDeletingBudget] = useState<Allocation | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const migrationRef = useRef<Promise<void> | null>(null)

  const monthKey = format(month, 'yyyy-MM')
  useEffect(() => localStorage.setItem('pocketplan-active-month', monthKey), [monthKey])

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return }
    const client = supabase
    const openSession = async () => {
      const { data } = await client.auth.getSession()
      setSession(data.session)
      setAuthLoading(false)
    }
    openSession()
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthLoading(false) })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    const passwordPending = localStorage.getItem('pocketplan-password-pending')
    if (session.user.is_anonymous || (passwordPending && session.user.email === passwordPending)) setAccountOpen(true)
  }, [session])

  const migrateLocalDrafts = async (userId: string) => {
    const migrationKey = `pocketplan-cloud-migrated:${userId}`
    if (localStorage.getItem(migrationKey)) return
    const raw = localStorage.getItem('pocketplan-months')
    if (!raw) { localStorage.setItem(migrationKey, 'true'); return }
    let drafts: Record<string, { salary: number; allocations: Allocation[]; expenses: Expense[]; finalized: boolean }>
    try {
      drafts = JSON.parse(raw)
    } catch {
      throw new Error('Your previous on-device budget could not be read. It has been left untouched.')
    }
    for (const [key, draft] of Object.entries(drafts)) {
      const date = `${key}-01`
      if (await loadMonth(userId, date)) continue
      const remoteMonth = await ensureMonth(userId, date, draft.salary)
      for (const allocation of draft.allocations) await insertAllocation(userId, remoteMonth.id, { ...allocation, id: crypto.randomUUID(), label: allocation.label || inferredLabel(allocation.category) })
      for (const expense of draft.expenses) await saveExpense(userId, remoteMonth.id, { ...expense, id: crypto.randomUUID(), receipt_url: undefined })
      if (draft.finalized) await finalizeBudgetMonth(remoteMonth.id)
    }
    localStorage.setItem(migrationKey, 'true')
    localStorage.removeItem('pocketplan-months')
  }

  useEffect(() => {
    if (!session) return
    let active = true
    const hydrate = async () => {
      setDataLoading(true)
      setSaveError('')
      try {
        if (!migrationRef.current) migrationRef.current = migrateLocalDrafts(session.user.id)
        await migrationRef.current
        let remote = await loadMonth(session.user.id, `${monthKey}-01`)
        if (!remote) {
          await ensureMonth(session.user.id, `${monthKey}-01`, 0)
          remote = await loadMonth(session.user.id, `${monthKey}-01`)
        }
        if (!active || !remote) return
        setBudgetMonthId(remote.budgetMonth.id)
        setSalary(Number(remote.budgetMonth.salary))
        setAllocations(remote.allocations)
        setExpenses(remote.expenses)
        setFinalized(remote.budgetMonth.is_finalized)
        setSalaryDirty(false)
        setSaveState('saved')
      } catch (error) {
        if (active) { setSaveState('error'); setSaveError(error instanceof Error ? error.message : 'Could not load your budget') }
      } finally {
        if (active) setDataLoading(false)
      }
    }
    hydrate()
    return () => { active = false }
  }, [session, monthKey])

  const persist = async <T,>(action: () => Promise<T>) => {
    setSaveState('saving')
    setSaveError('')
    try {
      const result = await action()
      setSaveState('saved')
      return result
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'Change was not saved')
      throw error
    }
  }

  useEffect(() => {
    if (!salaryDirty || !budgetMonthId || finalized) return
    const timer = window.setTimeout(() => {
      persist(() => updateMonthSalary(budgetMonthId, salary)).then(() => setSalaryDirty(false)).catch(() => undefined)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [salary, salaryDirty, budgetMonthId, finalized])

  const allocated = allocations.reduce((sum, item) => sum + item.amount, 0)
  const spent = expenses.reduce((sum, item) => sum + item.amount, 0)
  const budgeted = allocations.filter(a => a.status !== 'pending').reduce((sum, a) => sum + a.amount, 0)
  const remaining = salary - allocated

  const chooseMonth = (target: Date) => setMonth(target)
  const shiftMonth = (direction: number) => chooseMonth(addMonths(month, direction))
  const startNextMonth = async () => {
    if (!session) return
    const target = addMonths(month, 1)
    try {
      await persist(() => copyPlanToMonth(session.user.id, `${format(target, 'yyyy-MM')}-01`, salary, allocations))
      setMonth(target)
      setTab('budget')
    } catch { /* save indicator explains the failure */ }
  }
  const toggleStatus = async (id: string) => {
    if (finalized) return
    const current = allocations.find(item => item.id === id)
    if (!current) return
    const nextStatus: Record<BudgetStatus, BudgetStatus> = { pending: 'budgeted', budgeted: 'paid', paid: 'pending' }
    const changed = { ...current, status: nextStatus[current.status] }
    try { const saved = await persist(() => updateAllocation(changed)); setAllocations(items => items.map(item => item.id === id ? saved : item)) } catch { /* keep previous value */ }
  }

  const saveBudgetItem = async (item: Allocation) => {
    if (!session || !budgetMonthId) return
    try {
      const saved = editingBudget ? await persist(() => updateAllocation(item)) : await persist(() => insertAllocation(session.user.id, budgetMonthId, item))
      setAllocations(items => editingBudget ? items.map(existing => existing.id === saved.id ? saved : existing) : [...items, saved])
      setModal(null)
      setEditingBudget(null)
    } catch { /* keep modal open */ }
  }

  const deleteBudgetItem = async () => {
    if (!deletingBudget) return
    try { await persist(() => removeAllocation(deletingBudget.id)); setAllocations(items => items.filter(item => item.id !== deletingBudget.id)); setDeletingBudget(null) } catch { /* keep confirmation open */ }
  }

  const finalizeMonth = async () => {
    if (!budgetMonthId) return
    try { await persist(() => finalizeBudgetMonth(budgetMonthId)); setFinalized(true) } catch { /* remain editable */ }
  }

  const retrySalarySave = () => {
    if (!salaryDirty || !budgetMonthId || finalized) return
    persist(() => updateMonthSalary(budgetMonthId, salary)).then(() => setSalaryDirty(false)).catch(() => undefined)
  }

  const saveNewExpense = async (item: Expense, receipt?: File | null) => {
    if (!session || !budgetMonthId) return
    try { const saved = await persist(() => saveExpense(session.user.id, budgetMonthId, item, receipt)); setExpenses(items => [saved, ...items]); setModal(null) } catch { /* keep modal open */ }
  }

  if (authLoading) return <div className="app-loading"><div className="brand-mark"><WalletCards/></div><p>Opening PocketPlan…</p></div>
  if (!isSupabaseConfigured || !supabase) return <div className="app-loading"><p>Supabase is not configured.</p></div>
  if (!session) return <LoginScreen/>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><WalletCards size={21}/></div><span>PocketPlan</span></div>
        <nav>
          <NavButton icon={<Home/>} label="Overview" active={tab === 'overview'} onClick={() => setTab('overview')}/>
          <NavButton icon={<Target/>} label="My budget" active={tab === 'budget'} onClick={() => setTab('budget')}/>
          <NavButton icon={<ReceiptText/>} label="Expenses" active={tab === 'expenses'} onClick={() => setTab('expenses')}/>
          <NavButton icon={<BarChart3/>} label="Insights" active={tab === 'insights'} onClick={() => setTab('insights')}/>
        </nav>
        <div className="side-tip"><Sparkles size={18}/><div><b>Small steps add up</b><span>You saved 22% more than last month.</span></div></div>
        <button className="settings" onClick={() => setAccountOpen(true)}><Settings size={19}/> Account</button>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">MY MONEY</p><h1>{tab === 'overview' ? 'Good evening, Ali' : tab === 'budget' ? 'Monthly budget' : tab === 'expenses' ? 'Your expenses' : 'Spending insights'}</h1><SaveIndicator state={saveState} error={saveError} onRetry={salaryDirty ? retrySalarySave : undefined}/></div>
          <div className="top-actions">
            <button className="next-month-button" onClick={startNextMonth}>Plan {format(addMonths(month, 1), 'MMM')} <ChevronRight/></button>
            <MonthPicker month={month} shiftMonth={shiftMonth}/>
            <button className="avatar">AK</button>
          </div>
        </header>

        {dataLoading ? <div className="data-loading"><i className="scan-spinner"/> Loading {format(month, 'MMMM')}…</div> : <>
        {tab === 'overview' && <Overview salary={salary} allocated={allocated} budgeted={budgeted} spent={spent} remaining={remaining} allocations={allocations} expenses={expenses} setTab={setTab} openModal={setModal}/>} 
        {tab === 'budget' && <Budget month={month} salary={salary} setSalary={(value: number) => { setSalary(value); setSalaryDirty(true); setSaveState('saving') }} allocations={allocations} allocated={allocated} finalized={finalized} toggleStatus={toggleStatus} openModal={() => { setEditingBudget(null); setModal('budget') }} editBudget={(item: Allocation) => { setEditingBudget(item); setModal('budget') }} deleteBudget={setDeletingBudget} finalize={finalizeMonth}/>} 
        {tab === 'expenses' && <Expenses month={month} expenses={expenses} openModal={() => setModal('expense')}/>} 
        {tab === 'insights' && <Insights month={month} allocations={allocations} expenses={expenses} spent={spent}/>} 
        </>}
      </main>

      <nav className="mobile-nav">
        <NavButton icon={<Home/>} label="Home" active={tab === 'overview'} onClick={() => setTab('overview')}/>
        <NavButton icon={<Target/>} label="Budget" active={tab === 'budget'} onClick={() => setTab('budget')}/>
        <button className="mobile-add" onClick={() => setModal('expense')}><Plus/></button>
        <NavButton icon={<ReceiptText/>} label="Expenses" active={tab === 'expenses'} onClick={() => setTab('expenses')}/>
        <NavButton icon={<BarChart3/>} label="Insights" active={tab === 'insights'} onClick={() => setTab('insights')}/>
      </nav>

      {modal === 'budget' && <BudgetModal item={editingBudget} onClose={() => { setModal(null); setEditingBudget(null) }} onSave={saveBudgetItem}/>} 
      {modal === 'expense' && <ExpenseModal onClose={() => setModal(null)} onSave={saveNewExpense}/>} 
      {deletingBudget && <ConfirmDelete item={deletingBudget} onClose={() => setDeletingBudget(null)} onConfirm={deleteBudgetItem}/>} 
      {accountOpen && <AccountModal session={session} onClose={() => setAccountOpen(false)}/>}
    </div>
  )
}

function SaveIndicator({ state, error, onRetry }: { state: SaveState; error: string; onRetry?: () => void }) {
  if (state === 'saving') return <span className="save-indicator saving"><i/> Saving to cloud…</span>
  if (state === 'error') return <span className="save-indicator error" title={error}><X/> Not saved{onRetry && <button onClick={onRetry}>Retry</button>}</span>
  if (state === 'saved') return <span className="save-indicator saved"><CircleCheck/> Saved to cloud</span>
  return null
}

function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'secure'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    setSent(false)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMessage(error.message)
    } else {
      const emailRedirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo, data: { pocketplan_recovery: true } },
      })
      if (error) setMessage(error.message)
      else if (data.session) {
        setMessage('Account created and signed in. Your browser will remember this session.')
        setSent(true)
      } else {
        setMessage('Verification email sent. Open the link in that email on this device, then return to PocketPlan.')
        setSent(true)
      }
    }
    setBusy(false)
  }
  const switchMode = () => {
    setMode(current => current === 'signin' ? 'secure' : 'signin')
    setMessage('')
    setSent(false)
    setPassword('')
  }
  return <div className="auth-page"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><WalletCards/></div><span>PocketPlan</span></div><h1>{mode === 'signin' ? 'Welcome back' : 'Secure my existing budget'}</h1><p>{mode === 'signin' ? 'Sign in with your permanent PocketPlan account.' : 'Create a permanent account. We will connect your existing July and August budgets after you verify your email.'}</p><form onSubmit={submit}><label>Email<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label><label>Password<input required minLength={8} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'secure' ? 'At least 8 characters' : undefined}/></label>{mode === 'secure' && <p className="account-note">Use an email you can open on this phone. Your password stays private and is handled securely by Supabase.</p>}{message && <div className={`auth-message${sent ? ' account-message' : ''}`}>{message}</div>}<button className="primary" disabled={busy || sent}>{busy ? (mode === 'signin' ? 'Signing in…' : 'Sending…') : sent ? 'Check your email' : mode === 'signin' ? 'Sign in' : 'Create account & send link'}</button></form><button className="auth-switch" type="button" onClick={switchMode}>{mode === 'signin' ? 'First time here? Secure my existing budget' : 'Already created an account? Sign in'}</button></div></div>
}

function AccountModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const isAnonymous = Boolean(session.user.is_anonymous)
  const needsPassword = !isAnonymous && localStorage.getItem('pocketplan-password-pending') === session.user.email
  const [email, setEmail] = useState(session.user.email || '')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const secureEmail = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const redirect = `${window.location.origin}/pocketplan/`
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirect })
    if (error) setMessage(error.message)
    else {
      localStorage.setItem('pocketplan-password-pending', email)
      setMessage('Verification email sent. Open its link on this device, then return to PocketPlan to set your password.')
    }
    setBusy(false)
  }

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setMessage(error.message)
    else {
      localStorage.removeItem('pocketplan-password-pending')
      setPassword('')
      setMessage('Account secured. This browser will stay signed in.')
    }
    setBusy(false)
  }

  if (isAnonymous) return <ModalFrame title="Protect your PocketPlan" subtitle="Add an email now without changing or moving your existing data." onClose={onClose}><form onSubmit={secureEmail}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label><p className="account-note">Your current budgets stay attached to this account. After verification, PocketPlan will ask you to create a password.</p>{message && <div className="auth-message account-message">{message}</div>}<button className="primary submit" disabled={busy}>{busy ? 'Sending…' : 'Send verification email'}</button></form></ModalFrame>

  if (needsPassword) return <ModalFrame title="Create your password" subtitle={`Your email ${session.user.email} is verified.`} onClose={onClose}><form onSubmit={savePassword}><label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters"/></label>{message && <div className="auth-message account-message">{message}</div>}<button className="primary submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button></form></ModalFrame>

  return <ModalFrame title="Your account" subtitle="Your browser keeps this session active automatically." onClose={onClose}><div className="account-summary"><b>{session.user.email}</b><span>Protected account</span></div><form onSubmit={savePassword}><label>Change password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="New password"/></label>{message && <div className="auth-message account-message">{message}</div>}<button className="primary submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button><button className="auth-signout" type="button" onClick={() => supabase?.auth.signOut({ scope: 'local' })}>Sign out on this device</button></form></ModalFrame>
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'nav-active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>
}

function MonthPicker({ month, shiftMonth }: { month: Date; shiftMonth: (n: number) => void }) {
  return <div className="month-picker"><button aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft/></button><div><CalendarDays/><span>{format(month, 'MMMM yyyy')}</span></div><button aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight/></button></div>
}

function Overview({ salary, allocated, budgeted, spent, remaining, allocations, expenses, setTab, openModal }: any) {
  const percentage = Math.min(100, Math.round((allocated / salary) * 100))
  return <div className="page-content">
    <section className="hero-card">
      <div className="hero-copy"><span className="soft-label">AVAILABLE TO BUDGET</span><h2>{money(remaining)}</h2><p>of {money(salary)} monthly income</p><div className="hero-actions"><button className="primary" onClick={() => setTab('budget')}>Review my budget <ChevronRight/></button><button className="secondary" onClick={() => openModal('expense')}><Plus/> Add expense</button></div></div>
      <div className="progress-orbit" style={{'--progress': `${percentage * 3.6}deg`} as React.CSSProperties}><div><b>{percentage}%</b><span>allocated</span></div></div>
    </section>

    <section className="metric-grid">
      <Metric icon={<CircleDollarSign/>} tone="sage" label="Budgeted" value={money(budgeted)} note={`${allocations.filter((a: Allocation) => a.status !== 'pending').length} transfers complete`}/>
      <Metric icon={<ReceiptText/>} tone="clay" label="Spent this month" value={money(spent)} note="Down 8% from June" positive/>
      <Metric icon={<Target/>} tone="blue" label="Planned" value={money(allocated)} note={`${money(Math.max(0, salary - allocated))} still unassigned`}/>
    </section>

    <div className="overview-grid">
      <section className="panel"><PanelTitle title="Budget plan" action="View all" onClick={() => setTab('budget')}/><div className="budget-list">{allocations.slice(0,4).map((item: Allocation) => <BudgetRow key={item.id} item={item}/>)}</div></section>
      <section className="panel"><PanelTitle title="Recent expenses" action="View all" onClick={() => setTab('expenses')}/><div className="expense-list">{expenses.slice(0,4).map((item: Expense) => <ExpenseRow key={item.id} item={item}/>)}</div></section>
    </div>
  </div>
}

function Metric({ icon, tone, label, value, note, positive }: any) { return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><b>{value}</b><small className={positive ? 'positive' : ''}>{positive && <TrendingDown size={13}/>} {note}</small></div></div> }
function PanelTitle({ title, action, onClick }: { title: string; action: string; onClick: () => void }) { return <div className="panel-title"><h3>{title}</h3><button onClick={onClick}>{action}<ChevronRight/></button></div> }

function Budget({ month, salary, setSalary, allocations, allocated, finalized, toggleStatus, openModal, editBudget, deleteBudget, finalize }: any) {
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [labelFilter, setLabelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const pending = allocations.filter((a: Allocation) => a.status === 'pending').length
  const categories: string[] = [...new Set((allocations as Allocation[]).map(item => item.category))].sort((a, b) => a.localeCompare(b))
  const filteredAllocations = allocations.filter((item: Allocation) =>
    (categoryFilter === 'all' || item.category === categoryFilter) &&
    (labelFilter === 'all' || item.label === labelFilter) &&
    (statusFilter === 'all' || item.status === statusFilter),
  )
  const filteredTotal = filteredAllocations.reduce((sum: number, item: Allocation) => sum + item.amount, 0)
  return <div className="page-content">
    {finalized && <div className="locked-banner"><LockKeyhole/><div><b>This month is finalized</b><span>Your {format(month, 'MMMM')} budget is locked and safely stored. Expenses can still be added.</span></div></div>}
    <div className="budget-header panel">
      <div><span>MONTHLY SALARY</span><div className="salary-input"><small>BHD</small><input type="number" value={salary} disabled={finalized} onChange={e => setSalary(Number(e.target.value))}/></div></div>
      <div className="budget-summary"><div><span>Allocated</span><b>{money(allocated)}</b></div><div><span>Left to plan</span><b className={salary - allocated < 0 ? 'danger' : ''}>{money(salary - allocated)}</b></div></div>
    </div>
    <section className="panel budget-panel"><div className="panel-title"><div><h3>Your categories</h3><p>{pending ? `${pending} transfers still pending` : 'All transfers completed'}</p></div><button className="add-button" disabled={finalized} onClick={openModal}><Plus/> Add category</button></div>
      <div className="budget-filters">
        <label>Category<select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Label<select value={labelFilter} onChange={event => setLabelFilter(event.target.value)}><option value="all">All labels</option>{budgetLabels.map(label => <option key={label} value={label}>#{label}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="budgeted">Budgeted</option><option value="paid">Paid</option></select></label>
        <div className="filtered-total"><span>Visible total</span><b>{money(filteredTotal)}</b><small>{filteredAllocations.length} of {allocations.length} lines</small></div>
      </div>
      <div className="allocation-table"><div className="table-head"><span>Category</span><span>Amount</span><span>Status</span><span aria-hidden="true"/></div>{filteredAllocations.map((item: Allocation) => <div className="allocation-row" key={item.id}><div className="category-cell"><span className="category-icon" style={{background: `${item.color}18`}}>{item.icon}</span><div><b>{item.category}</b><small className="budget-label">#{item.label}</small></div></div><strong>{money(item.amount)}</strong><button disabled={finalized} className={`status ${item.status}`} onClick={() => toggleStatus(item.id)}>{item.status === 'pending' ? <span className="status-dot"/> : <CircleCheck/>}{item.status}</button><div className="row-actions"><button disabled={finalized} aria-label={`Edit ${item.category}`} onClick={() => editBudget(item)}><Pencil/></button><button disabled={finalized} className="delete-action" aria-label={`Delete ${item.category}`} onClick={() => deleteBudget(item)}><Trash2/></button></div></div>)}{!filteredAllocations.length && <div className="filter-empty">No budget lines match these filters.</div>}</div>
    </section>
    {!finalized && <div className="finalize-bar"><div><LockKeyhole/><span><b>Ready to close the month?</b> Finalizing locks salary and budget categories.</span></div><button className="primary" onClick={finalize}>Finalize {format(month, 'MMMM')}</button></div>}
  </div>
}

function Expenses({ month, expenses, openModal }: { month: Date; expenses: Expense[]; openModal: () => void }) {
  const grouped = expenses.reduce<Record<string, number>>((a,e) => ({...a, [e.category]: (a[e.category] || 0) + e.amount}), {})
  const maxCategory = Math.max(1, ...Object.values(grouped))
  return <div className="page-content">
    <div className="section-heading"><div><p>Every purchase, in one place</p><h2>{money(expenses.reduce((s,e) => s + e.amount,0))} spent in {format(month, 'MMMM')}</h2></div><button className="primary" onClick={openModal}><Plus/> Add expense</button></div>
    <div className="expense-layout"><section className="panel"><div className="panel-title"><h3>All expenses</h3><button>Newest first <ChevronDown/></button></div><div className="expense-list large">{expenses.map(item => <ExpenseRow item={item} key={item.id}/>)}</div></section>
      <section className="panel category-summary"><h3>By category</h3>{Object.entries(grouped).sort((a,b) => b[1]-a[1]).map(([cat, amount]) => { const c=categoryOptions.find(x=>x.name===cat); return <div key={cat}><span>{c?.icon || '✨'} {cat}</span><b>{money(amount)}</b><div><i style={{width:`${amount/maxCategory*100}%`, background:c?.color}}/></div></div>})}</section>
    </div>
  </div>
}

function Insights({ month, allocations, expenses, spent }: { month: Date; allocations: Allocation[]; expenses: Expense[]; spent: number }) {
  const highest = useMemo(() => expenses.reduce<Record<string,number>>((a,e)=>({...a,[e.category]:(a[e.category]||0)+e.amount}),{}),[expenses])
  const top = Object.entries(highest).sort((a,b)=>b[1]-a[1])[0]
  const receipts = expenses.filter(expense => expense.receipt_url)
  const monthName = format(month, 'MMMM')
  return <div className="page-content">
    <section className="insight-hero"><div><span>{monthName.toUpperCase()} SNAPSHOT</span><h2>You’re spending with more intention.</h2><p>Use this view to compare your plan, spending, and saved receipts.</p></div><Sparkles/></section>
    <section className="panel chart-panel"><div className="panel-title"><div><h3>Budget vs. actual spending</h3><p>Your six-month rhythm</p></div><div className="legend"><span><i className="budget-key"/>Budget</span><span><i className="spent-key"/>Spent</span></div></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={monthlyTrend}><defs><linearGradient id="spent" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c37254" stopOpacity={.35}/><stop offset="100%" stopColor="#c37254" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="month" axisLine={false} tickLine={false}/><Tooltip formatter={(v:number)=>money(v)}/><Area type="monotone" dataKey="budget" stroke="#667b69" fill="none" strokeWidth={2}/><Area type="monotone" dataKey="spent" stroke="#c37254" fill="url(#spent)" strokeWidth={3}/></AreaChart></ResponsiveContainer></div></section>
    <div className="metric-grid insights"><Metric icon={<TrendingDown/>} tone="sage" label="Monthly spend" value={money(spent)} note={`Recorded in ${monthName}`}/><Metric icon={<Target/>} tone="clay" label="Top category" value={top?.[0] || '—'} note={top ? money(top[1]) : 'No expenses yet'}/><Metric icon={<Sparkles/>} tone="blue" label="Receipts saved" value={`${receipts.length}`} note={`${monthName} attachments`}/></div>
    <section className="panel receipt-library"><div className="panel-title"><div><h3>Receipt library</h3><p>All {monthName} invoices and attachments in one place</p></div><span className="receipt-count">{receipts.length} receipts</span></div>{receipts.length ? <div className="receipt-grid">{receipts.map(expense => <a className="receipt-card" key={expense.id} href={expense.receipt_url} target="_blank" rel="noreferrer"><div className="receipt-preview"><img src={expense.receipt_url} alt={`${expense.merchant} receipt`}/><span><Camera/> View</span></div><div><b>{expense.merchant}</b><small>{expense.category} · {format(parseISO(expense.spent_at), 'd MMM')}</small><strong>{money(expense.amount)}</strong></div></a>)}</div> : <div className="receipt-empty"><div><ReceiptText/></div><h4>No receipts added yet</h4><p>Receipts you attach to expenses will automatically appear here for quick review.</p></div>}</section>
  </div>
}

function BudgetRow({ item }: { item: Allocation }) { return <div className="budget-row"><span className="category-icon" style={{background:`${item.color}18`}}>{item.icon}</span><div><b>{item.category}</b><small>{item.status} · #{item.label}</small></div><strong>{money(item.amount)}</strong></div> }
function ExpenseRow({ item }: { item: Expense }) { const c=categoryOptions.find(x=>x.name===item.category); return <div className="expense-row"><span className="category-icon" style={{background:`${c?.color}18`}}>{c?.icon || '✨'}</span><div><b>{item.merchant}</b><small>{item.category} · {format(parseISO(item.spent_at), 'd MMM')}</small></div>{item.receipt_url && <Camera className="receipt-mark"/>}<strong>−{money(item.amount)}</strong></div> }

function ModalFrame({ title, subtitle, onClose, children }: any) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose}><X/></button></div>{children}</div></div> }
function BudgetModal({ item, onClose, onSave }: { item: Allocation | null; onClose: () => void; onSave: (item: Allocation) => void }) { const matched=categoryOptions.find(c=>c.name===item?.category); const [category,setCategory]=useState(item?.category || categoryOptions[0].name); const [amount,setAmount]=useState(item ? String(item.amount) : ''); const [label,setLabel]=useState<Allocation['label']>(item?.label || inferredLabel(item?.category || categoryOptions[0].name)); const selected=categoryOptions.find(c=>c.name===category) || matched || { icon:item?.icon || '✨', color:item?.color || '#77756d' }; return <ModalFrame title={item ? 'Edit budget category' : 'Add budget category'} subtitle={item ? 'Update this part of your monthly plan.' : 'Plan where your salary should go.'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(amount==='')return;onSave({id:item?.id || crypto.randomUUID(),category,amount:Number(amount),status:item?.status || 'pending',icon:selected.icon,color:selected.color,label})}}><label>Category<input list="budget-categories" value={category} onChange={e=>setCategory(e.target.value)} placeholder="Category name"/><datalist id="budget-categories">{categoryOptions.map(c=><option key={c.name} value={c.name}/>)}</datalist></label><label>Label<select value={label} onChange={e=>setLabel(e.target.value as Allocation['label'])}>{budgetLabels.map(option => <option key={option} value={option}>#{option}</option>)}</select></label><label>Planned amount<div className="input-affix"><span>BHD</span><input autoFocus required type="number" step="0.001" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.000"/></div></label><p className="form-note"><span className="status-dot"/> {item ? `Status remains ${item.status} after editing.` : 'New categories start as pending until you confirm the transfer.'}</p><button className="primary submit" type="submit">{item ? 'Save changes' : 'Add to my plan'}</button></form></ModalFrame> }
function ConfirmDelete({ item, onClose, onConfirm }: { item: Allocation; onClose: () => void; onConfirm: () => void }) { return <ModalFrame title="Delete budget category?" subtitle="This will update your monthly totals immediately." onClose={onClose}><div className="delete-summary"><span className="category-icon" style={{background:`${item.color}18`}}>{item.icon}</span><div><b>{item.category}</b><small>{money(item.amount)}</small></div></div><div className="confirm-actions"><button className="cancel-button" onClick={onClose}>Keep category</button><button className="danger-button" onClick={onConfirm}><Trash2/> Delete</button></div></ModalFrame> }
async function receiptImageData(file: File) {
  const source = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  source.close()
  return canvas.toDataURL('image/jpeg', .82)
}

function receiptCategory(text: string) {
  const rules: Array<[string, RegExp]> = [
    ['Groceries', /\b(lulu|carrefour|hypermarket|supermarket|grocery|groceries|market|vegetable|bakery)\b/i],
    ['Dining', /\b(restaurant|cafe|coffee|food|burger|pizza|kitchen|eatery|grill|diner)\b/i],
    ['Transport', /\b(petrol|fuel|gas station|taxi|uber|careem|parking|car wash)\b/i],
    ['Health', /\b(pharmacy|clinic|hospital|medical|dental|health)\b/i],
    ['Bills', /\b(batelco|stc|zain|ewa|electricity|water|internet|telecom)\b/i],
    ['Shopping', /\b(fashion|clothing|apparel|mall|store|shop|shoes|electronics)\b/i],
    ['Entertainment', /\b(cinema|movie|game|bowling|entertainment)\b/i],
    ['Travel', /\b(hotel|airline|flight|travel|booking)\b/i],
    ['Education', /\b(school|book|stationery|education|tuition)\b/i],
  ]
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || 'Other'
}

function normalizeReceiptText(text: string) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
  const easternDigits = '۰۱۲۳۴۵۶۷۸۹'
  return [...text].map(character => {
    const arabic = arabicDigits.indexOf(character)
    if (arabic >= 0) return String(arabic)
    const eastern = easternDigits.indexOf(character)
    return eastern >= 0 ? String(eastern) : character
  }).join('')
}

function receiptDate(text: string) {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.]([0-2]?\d|3[01])\b/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`
  const local = text.match(/\b([0-2]?\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/)
  if (local) return `${local[3].length === 2 ? `20${local[3]}` : local[3]}-${local[2].padStart(2,'0')}-${local[1].padStart(2,'0')}`
  return new Date().toISOString().slice(0,10)
}

function receiptAmount(lines: string[]) {
  const amountPattern = /(\d{1,5}(?:[.,]\d{2,3}))/g
  const preferred = lines.filter(line => /\b(grand total|net total|amount due|total due|total)\b/i.test(line) && !/\b(subtotal|tax|vat)\b/i.test(line))
  for (const line of [...preferred.reverse(), ...lines.slice().reverse()]) {
    const values = [...line.matchAll(amountPattern)].map(match => Number(match[1].replace(',','.'))).filter(value => Number.isFinite(value) && value < 100000)
    if (values.length) return values.at(-1)!
  }
  return 0
}

function receiptMerchant(lines: string[]) {
  const ignored = /\b(receipt|invoice|tax|vat|tel|phone|date|time|cashier|branch|customer|welcome)\b/i
  return lines.find(line => /[a-z]{3}/i.test(line) && !ignored.test(line) && line.length >= 3 && line.length <= 55)?.replace(/[^\p{L}\p{N}&' .-]/gu,'').trim() || 'Receipt purchase'
}

function ExpenseModal({ onClose, onSave }: { onClose: () => void; onSave: (item: Expense, receipt?: File | null) => void }) {
  const [merchant,setMerchant]=useState('')
  const [amount,setAmount]=useState('')
  const [category,setCategory]=useState('Groceries')
  const [spentAt,setSpentAt]=useState(new Date().toISOString().slice(0,10))
  const [note,setNote]=useState('')
  const [file,setFile]=useState<File|null>(null)
  const [scanning,setScanning]=useState(false)
  const [scanError,setScanError]=useState('')
  const [confidence,setConfidence]=useState<number|null>(null)
  const [scanProgress,setScanProgress]=useState(0)

  const scanReceipt = async (receipt: File) => {
    setFile(receipt)
    setScanning(true)
    setScanError('')
    setConfidence(null)
    setScanProgress(0)
    try {
      const image = await receiptImageData(receipt)
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['eng', 'ara'], 1, { logger: message => {
        if (message.status === 'recognizing text') setScanProgress(Math.round(message.progress * 100))
      }})
      const result = await worker.recognize(image)
      await worker.terminate()
      const receiptText = normalizeReceiptText(result.data.text)
      const lines = receiptText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      const amountFound = receiptAmount(lines)
      setMerchant(receiptMerchant(lines))
      setAmount(amountFound ? String(amountFound) : '')
      setCategory(receiptCategory(receiptText))
      setSpentAt(receiptDate(receiptText))
      setNote('Scanned locally from receipt')
      setConfidence(result.data.confidence / 100)
      if (!amountFound) setScanError('I read the receipt, but could not confidently find the total. Please enter it below.')
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Receipt scan failed')
    } finally {
      setScanning(false)
    }
  }

  return <ModalFrame title="Add an expense" subtitle="Upload the receipt and let PocketPlan fill the details." onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();onSave({id:crypto.randomUUID(),merchant,amount:Number(amount),category,spent_at:spentAt,note}, file)}}>
      <label className={`upload receipt-first ${scanning ? 'is-scanning' : ''}`}><input type="file" accept="image/*" capture="environment" onChange={e=>{const receipt=e.target.files?.[0];if(receipt)scanReceipt(receipt)}}/><Camera/><span><b>{scanning ? `Reading your receipt… ${scanProgress}%` : file ? file.name : 'Photograph or upload receipt'}</b><small>{scanning ? 'Processing privately on this device' : 'No API fee · image stays on your device'}</small></span>{scanning && <i className="scan-spinner"/>}</label>
      {scanError && <div className="scan-message error">{scanError}<button type="button" onClick={() => file && scanReceipt(file)}>Try again</button></div>}
      {confidence !== null && <div className="scan-message success"><CircleCheck/> Receipt read · {Math.round(confidence*100)}% confidence. Please review.</div>}
      <label>Merchant or description<input required value={merchant} onChange={e=>setMerchant(e.target.value)} placeholder="Filled from receipt"/></label>
      <div className="form-grid"><label>Amount<div className="input-affix"><span>BHD</span><input required type="number" step="0.001" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.000"/></div></label><label>Date<input required type="date" value={spentAt} onChange={e=>setSpentAt(e.target.value)}/></label></div>
      <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{categoryOptions.filter(c=>c.name!=='Savings').map(c=><option key={c.name}>{c.name}</option>)}</select></label>
      <label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional receipt summary"/></label>
      <button className="primary submit" type="submit" disabled={scanning || !merchant || !amount}>{scanning ? 'Reading receipt…' : 'Save expense'}</button>
    </form>
  </ModalFrame>
}

export default App
