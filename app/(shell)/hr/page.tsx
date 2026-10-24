'use client';

/**
 * People, pay and advances.
 *
 * Four tabs out of the module's eight — employees, departments, payroll and loans. Attendance,
 * leave, contracts and documents are each their own screen and are left for later; these four
 * are the ones the rest of the system already reaches into.
 *
 * ── The loan is the reason this exists ────────────────────────────────────────────────────
 *
 * An employee asks for an advance from `/my-loans`, which has been live for a while with
 * nobody able to answer it. The request lands here, and approving it creates the loan, pays it
 * out of the treasury and posts the entry — `hr.loans.accountingHint` spells the double entry
 * out. From then on the monthly deduction comes off the payslip by itself: a run built while a
 * loan is open carries `loanDeduction` on the line, and the API caps it at half the adjusted
 * gross so a large instalment cannot swallow a salary.
 *
 * ── A payroll run is a document, not a calculation ────────────────────────────────────────
 *
 * DRAFT can be rebuilt as often as the underlying data changes. POSTED writes the journal
 * entries. PAID moves the money. Each step is one-way and the API refuses the next without the
 * previous, so the buttons follow the status rather than all being present and mostly failing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { PageHero, Panel, Skeleton } from '@/components/page';

type Employee = {
  id: string; code: string | null; name: string; jobTitle: string | null;
  departmentId: string | null; departmentName: string | null;
  hireDate: string | null; status: 'ACTIVE' | 'ARCHIVED' | 'LEFT';
  baseSalary: number; housingAllowance: number; transportAllowance: number;
  otherAllowances: number; socialInsuranceEmployee: number; socialInsuranceEmployer: number;
  phone: string | null; email: string | null; userId: string | null;
};

type Department = { id: string; code: string | null; name: string; employeeCount?: number };

type PayrollStatus = 'DRAFT' | 'POSTED' | 'PAID' | 'CANCELLED';

type PayrollLine = {
  id: string; employeeName: string; employeeCode: string | null;
  baseSalary: number; gross: number; loanDeduction: number;
  socialInsuranceEmployee: number; leaveDeduction: number; netPay?: number; net?: number;
};

type PayrollRun = {
  id: string; number: string; periodYear: number; periodMonth: number;
  status: PayrollStatus; employeeCount: number;
  totalGross: number; totalNet: number; totalEmployerCost: number;
  lines?: PayrollLine[];
};

type Loan = {
  id: string; employeeId: string; employeeName: string; employeeCode: string | null;
  loanDate: string; principalAmount: number; remainingAmount: number;
  repaidAmount: number; monthlyDeduction: number; status: string; notes: string | null;
};

type LoanRequest = {
  id: string; employeeId: string; employeeName: string;
  amount: number; monthlyDeduction: number | null;
  status: string; reason: string | null; createdAt: string;
};

const PAYROLL_STYLE: Record<PayrollStatus, string> = {
  DRAFT: 'ae-badge-muted',
  POSTED: 'ae-badge-info',
  PAID: 'ae-badge-success',
  CANCELLED: 'ae-badge-danger',
};

const ERROR_KEY: Record<string, string> = {
  employee_not_found: 'hr.error.employee_not_found',
  employee_required: 'hr.error.employee_required',
  employee_user_already_linked: 'hr.error.employee_user_already_linked',
  payroll_not_found: 'hr.error.payroll_not_found',
  payroll_not_draft: 'hr.error.payroll_not_draft',
  payroll_already_posted: 'hr.error.payroll_already_posted',
  payroll_already_paid: 'hr.error.payroll_already_paid',
  payroll_not_posted: 'hr.error.payroll_not_posted',
  payroll_nothing_to_pay: 'hr.error.payroll_nothing_to_pay',
  invalid_loan_payload: 'hr.error.employee_required',
};

const BLANK_EMP = {
  name: '', code: '', jobTitle: '', departmentId: '', hireDate: '', phone: '',
  baseSalary: '', housingAllowance: '', transportAllowance: '',
  socialInsuranceEmployee: '', socialInsuranceEmployer: '',
};

export default function HrPage() {
  const { t, lang } = useI18n();
  const { can } = useSession();

  const [tab, setTab] = useState<'employees' | 'departments' | 'payroll' | 'loans'>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [openRun, setOpenRun] = useState<PayrollRun | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [empForm, setEmpForm] = useState<typeof BLANK_EMP & { id?: string }>({ ...BLANK_EMP });
  const [editingEmp, setEditingEmp] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [loanForm, setLoanForm] = useState({ employeeId: '', principalAmount: '', monthlyDeduction: '', notes: '' });
  const [creatingLoan, setCreatingLoan] = useState(false);

  const money = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', {
      style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
    }).format(v),
    [lang],
  );
  const num = useCallback(
    (v: number) => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-EG').format(v),
    [lang],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, d, p, l, r] = await Promise.all([
        api<{ items?: Employee[] }>('/hr/employees'),
        api<Department[]>('/hr/departments'),
        api<PayrollRun[] | { items?: PayrollRun[] }>('/hr/payroll'),
        api<{ items?: Loan[] }>('/hr/loans'),
        api<{ items?: LoanRequest[] }>('/hr/loan-requests'),
      ]);
      setEmployees(e.items ?? []);
      setDepartments(Array.isArray(d) ? d : []);
      setRuns(Array.isArray(p) ? p : p.items ?? []);
      setLoans(l.items ?? []);
      setRequests(r.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? 'common.error' : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>, flashKey: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await fn();
      setFlash(flashKey);
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setError(ERROR_KEY[code] ?? 'common.error');
    } finally {
      setBusy(false);
    }
  }

  const manage = can('hr.manage');
  const payroll = can('hr.manage', 'hr.payroll.manage');

  const active = employees.filter((e) => e.status === 'ACTIVE');
  const openLoans = loans.filter((l) => l.remainingAmount > 0);
  const pending = requests.filter((r) => r.status?.toUpperCase() === 'PENDING');

  const gross = (e: Employee) =>
    e.baseSalary + e.housingAllowance + e.transportAllowance + e.otherAllowances;

  const monthLabel = (r: PayrollRun) =>
    new Date(r.periodYear, r.periodMonth - 1).toLocaleDateString(
      lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric' });

  const lineNet = (l: PayrollLine) => l.netPay ?? l.net ?? 0;

  return (
    <div className="ae-page">
      <PageHero
        title={t('hr.title')}
        actions={
          manage && tab === 'employees' && !editingEmp ? (
            <button type="button" className="ae-btn-primary"
              onClick={() => { setEmpForm({ ...BLANK_EMP }); setEditingEmp(true); }}>
              {t('hr.addEmployee')}
            </button>
          ) : payroll && tab === 'loans' && !creatingLoan ? (
            <button type="button" className="ae-btn-primary" onClick={() => setCreatingLoan(true)}>
              {t('hr.loans.create')}
            </button>
          ) : undefined
        }
      />

      {error && <p className="ae-flash ae-flash--error mb-4">{t(error)}</p>}
      {flash && <p className="ae-flash ae-flash--success mb-4">{t(flash)}</p>}

      <div className="ae-dash-metrics-grid mb-4">
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('hr.employees')}</p>
          <p className="ae-stat-value">{num(active.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('dashboard.hr.departments')}</p>
          <p className="ae-stat-value">{num(departments.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('hr.loans.activeCount')}</p>
          <p className="ae-stat-value">{num(openLoans.length)}</p>
        </div>
        <div className="ae-stat-card">
          <p className="ae-stat-label">{t('hr.loans.remaining')}</p>
          <p className={`ae-stat-value ${openLoans.length ? 'ae-stat-value--warn' : ''}`}>
            {money(openLoans.reduce((s, l) => s + l.remainingAmount, 0))}
          </p>
        </div>
      </div>

      {/* An employee asked for an advance and is waiting on an answer. */}
      {pending.length > 0 && payroll && (
        <Panel title={t('hr.loans.create')} className="mb-4">
          <ul className="ae-dash-attention">
            {pending.map((q) => (
              <li key={q.id} className="ae-dash-attention-row ae-dash-attention-row--warn">
                <span className="ae-dash-attention-label">
                  {q.employeeName} · {money(q.amount)}
                  {q.reason && <span className="block text-xs font-normal">{q.reason}</span>}
                </span>
                <span className="ae-action-icons">
                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                    onClick={() => void run(
                      () => api(`/hr/loan-requests/${q.id}/approve`, { method: 'POST' }).then(() => undefined),
                      'hr.loans.created')}>
                    {t('jobReview.approve')}
                  </button>
                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(t('quotes.rejectReasonPrompt')) ?? '';
                      void run(
                        () => api(`/hr/loan-requests/${q.id}/reject`, { method: 'POST', body: { reason } }).then(() => undefined),
                        'quotes.internalRejected');
                    }}>
                    {t('accounting.journals.reject')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="ae-tab-pills mb-4">
        {(['employees', 'departments', 'payroll', 'loans'] as const).map((x) => (
          <button key={x} type="button" onClick={() => { setTab(x); setError(null); setFlash(null); setOpenRun(null); }}
            className={`ae-tab-pill ${tab === x ? 'is-active' : ''}`}>
            {t(`hr.tab.${x}`)}
          </button>
        ))}
      </div>

      {tab === 'employees' && editingEmp && (
        <Panel title={t('hr.addEmployee')} className="ae-form-panel mb-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['name', 'hr.employeeName', 'text'],
              ['code', 'hr.employeeCode', 'text'],
              ['jobTitle', 'hr.jobTitle', 'text'],
              ['hireDate', 'hr.hireDate', 'date'],
              ['phone', 'party.phone', 'text'],
            ] as const).map(([field, label, type]) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block font-bold">{t(label)}</span>
                <input type={type} value={empForm[field]}
                  onChange={(e) => setEmpForm({ ...empForm, [field]: e.target.value })} className="ae-input" />
              </label>
            ))}
            <label className="text-sm">
              <span className="mb-1 block font-bold">{t('hr.tab.departments')}</span>
              <select value={empForm.departmentId}
                onChange={(e) => setEmpForm({ ...empForm, departmentId: e.target.value })} className="ae-input">
                <option value="" />
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['baseSalary', 'hr.baseSalary'],
              ['housingAllowance', 'hr.housingAllowance'],
              ['transportAllowance', 'hr.transportAllowance'],
              ['socialInsuranceEmployee', 'hr.socialInsuranceEmployee'],
              ['socialInsuranceEmployer', 'hr.socialInsuranceEmployer'],
            ] as const).map(([field, label]) => (
              <label key={field} className="text-sm">
                <span className="mb-1 block font-bold">{t(label)}</span>
                <input type="number" min="0" step="any" value={empForm[field]}
                  onChange={(e) => setEmpForm({ ...empForm, [field]: e.target.value })} className="ae-input" />
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="ae-btn-primary" disabled={busy || empForm.name.trim() === ''}
              onClick={() => void run(async () => {
                const body = {
                  name: empForm.name.trim(),
                  code: empForm.code.trim() || null,
                  jobTitle: empForm.jobTitle.trim() || null,
                  departmentId: empForm.departmentId || null,
                  hireDate: empForm.hireDate || null,
                  phone: empForm.phone.trim() || null,
                  baseSalary: Number(empForm.baseSalary || 0),
                  housingAllowance: Number(empForm.housingAllowance || 0),
                  transportAllowance: Number(empForm.transportAllowance || 0),
                  socialInsuranceEmployee: Number(empForm.socialInsuranceEmployee || 0),
                  socialInsuranceEmployer: Number(empForm.socialInsuranceEmployer || 0),
                };
                if (empForm.id) await api(`/hr/employees/${empForm.id}`, { method: 'PATCH', body });
                else await api('/hr/employees', { method: 'POST', body });
                setEditingEmp(false);
              }, 'hr.employeeSaved')}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="ae-btn-ghost" onClick={() => setEditingEmp(false)}>{t('common.cancel')}</button>
          </div>
        </Panel>
      )}

      {tab === 'employees' && (
        <Panel>
          {loading ? <Skeleton rows={6} /> : employees.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <div className="ae-table-wrap">
              <table className="ae-table ae-table--rows">
                <thead>
                  <tr>
                    <th>{t('hr.employeeName')}</th>
                    <th>{t('hr.jobTitle')}</th>
                    <th>{t('hr.tab.departments')}</th>
                    <th>{t('hr.grossSalary')}</th>
                    <th>{t('users.status')}</th>
                    {manage && <th>{t('users.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id} className={e.status === 'ACTIVE' ? undefined : 'opacity-60'}>
                      <td>
                        <span className="font-bold">{e.name}</span>
                        {e.code && <span className="mt-0.5 block text-xs text-[var(--text-muted)]" dir="ltr">{e.code}</span>}
                      </td>
                      <td>{e.jobTitle ?? '—'}</td>
                      <td>{e.departmentName ?? '—'}</td>
                      <td>{money(gross(e))}</td>
                      <td>
                        <span className={`ae-badge ${e.status === 'ACTIVE' ? 'ae-badge-success' : 'ae-badge-muted'}`}>
                          {t(`hr.status.${e.status}`)}
                        </span>
                      </td>
                      {manage && (
                        <td className="ae-actions-cell">
                          <button type="button" className="ae-btn-ghost px-3 py-1 text-xs"
                            onClick={() => {
                              setEmpForm({
                                id: e.id, name: e.name, code: e.code ?? '', jobTitle: e.jobTitle ?? '',
                                departmentId: e.departmentId ?? '', hireDate: e.hireDate ?? '', phone: e.phone ?? '',
                                baseSalary: String(e.baseSalary || ''), housingAllowance: String(e.housingAllowance || ''),
                                transportAllowance: String(e.transportAllowance || ''),
                                socialInsuranceEmployee: String(e.socialInsuranceEmployee || ''),
                                socialInsuranceEmployer: String(e.socialInsuranceEmployer || ''),
                              });
                              setEditingEmp(true);
                            }}>
                            {t('common.edit')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'departments' && (
        <Panel title={t('hr.tab.departments')}>
          {manage && (
            <div className="ae-toolbar mb-4">
              <input value={deptName} onChange={(e) => setDeptName(e.target.value)}
                placeholder={t('hr.deptName')} className="ae-input" />
              <button type="button" className="ae-btn-secondary" disabled={busy || deptName.trim() === ''}
                onClick={() => void run(async () => {
                  await api('/hr/departments', { method: 'POST', body: { name: deptName.trim() } });
                  setDeptName('');
                }, 'hr.deptSaved')}>
                {t('hr.addDepartment')}
              </button>
            </div>
          )}
          {departments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
          ) : (
            <ul className="space-y-2">
              {departments.map((d) => (
                <li key={d.id} className="ae-dash-attention-row">
                  <span className="ae-dash-attention-label">{d.name}</span>
                  <span className="ae-dash-attention-detail">
                    {num(employees.filter((e) => e.departmentId === d.id).length)} {t('hr.employees')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'payroll' && (
        <>
          {payroll && (
            <div className="ae-toolbar mb-4">
              <button type="button" className="ae-btn-secondary" disabled={busy}
                onClick={() => void run(async () => {
                  const now = new Date();
                  await api('/hr/payroll', {
                    method: 'POST',
                    body: { periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 },
                  });
                }, 'hr.payrollCreated')}>
                {t('hr.payrollRegister')}
              </button>
            </div>
          )}

          <Panel title={t('hr.tab.payroll')}>
            {loading ? <Skeleton rows={4} /> : runs.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
            ) : (
              <div className="ae-table-wrap">
                <table className="ae-table ae-table--rows">
                  <thead>
                    <tr>
                      <th>{t('accounting.journals.number')}</th>
                      <th>{t('reports.cashflow.month')}</th>
                      <th>{t('hr.employees')}</th>
                      <th>{t('hr.grossSalary')}</th>
                      <th>{t('hr.net')}</th>
                      <th>{t('users.status')}</th>
                      {payroll && <th>{t('users.actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <>
                        <tr key={r.id}>
                          <td>
                            <button type="button" className="font-bold underline" dir="ltr"
                              onClick={() => void (async () => {
                                if (openRun?.id === r.id) { setOpenRun(null); return; }
                                const full = await api<{ payroll?: PayrollRun } | PayrollRun>(`/hr/payroll/${r.id}`);
                                setOpenRun(('payroll' in full ? full.payroll : full) as PayrollRun);
                              })()}>
                              {r.number}
                            </button>
                          </td>
                          <td>{monthLabel(r)}</td>
                          <td>{num(r.employeeCount)}</td>
                          <td>{money(r.totalGross)}</td>
                          <td className="font-bold">{money(r.totalNet)}</td>
                          <td>
                            <span className={`ae-badge ${PAYROLL_STYLE[r.status]}`}>
                              {t(`hr.payrollStatus.${r.status}`)}
                            </span>
                          </td>
                          {payroll && (
                            <td className="ae-actions-cell whitespace-nowrap">
                              <span className="ae-action-icons">
                                {/* One way, one step at a time — the API refuses out of order. */}
                                {r.status === 'DRAFT' && (
                                  <>
                                    <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                      onClick={() => void run(
                                        () => api(`/hr/payroll/${r.id}/rebuild`, { method: 'POST' }).then(() => undefined),
                                        'hr.payrollRebuilt')}>
                                      {t('common.edit')}
                                    </button>
                                    <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                      onClick={() => void run(
                                        () => api(`/hr/payroll/${r.id}/post`, { method: 'POST' }).then(() => undefined),
                                        'hr.payrollPosted')}>
                                      {t('hr.postPayroll')}
                                    </button>
                                  </>
                                )}
                                {r.status === 'POSTED' && (
                                  <button type="button" className="ae-btn-ghost px-3 py-1 text-xs" disabled={busy}
                                    onClick={() => void run(
                                      () => api(`/hr/payroll/${r.id}/pay`, { method: 'POST' }).then(() => undefined),
                                      'hr.payrollPaid')}>
                                    {t('hr.payPayroll')}
                                  </button>
                                )}
                              </span>
                            </td>
                          )}
                        </tr>

                        {openRun?.id === r.id && (openRun.lines ?? []).map((l) => (
                          <tr key={l.id} className="text-xs">
                            <td colSpan={2}>{l.employeeName}</td>
                            <td>{money(l.gross)}</td>
                            {/* The instalment coming off the payslip, which is the whole point. */}
                            <td>{l.loanDeduction > 0 ? `−${money(l.loanDeduction)}` : '—'}</td>
                            <td>{l.socialInsuranceEmployee > 0 ? `−${money(l.socialInsuranceEmployee)}` : '—'}</td>
                            <td colSpan={2} className="font-bold">{money(lineNet(l))}</td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {tab === 'loans' && (
        <>
          {creatingLoan && (
            <Panel title={t('hr.loans.create')} className="ae-form-panel mb-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('hr.loans.employee')}</span>
                  <select value={loanForm.employeeId}
                    onChange={(e) => setLoanForm({ ...loanForm, employeeId: e.target.value })} className="ae-input">
                    <option value="" />
                    {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('hr.loans.principal')}</span>
                  <input type="number" min="0" step="any" value={loanForm.principalAmount}
                    onChange={(e) => setLoanForm({ ...loanForm, principalAmount: e.target.value })} className="ae-input" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('hr.loans.monthly')}</span>
                  <input type="number" min="0" step="any" value={loanForm.monthlyDeduction}
                    onChange={(e) => setLoanForm({ ...loanForm, monthlyDeduction: e.target.value })} className="ae-input" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-bold">{t('treasury.description')}</span>
                  <input value={loanForm.notes}
                    onChange={(e) => setLoanForm({ ...loanForm, notes: e.target.value })} className="ae-input" />
                </label>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{t('hr.loans.monthlyHint')}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t('hr.loans.accountingHint')}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="ae-btn-primary"
                  disabled={busy || loanForm.employeeId === '' || Number(loanForm.principalAmount) <= 0}
                  onClick={() => void run(async () => {
                    await api('/hr/loans', {
                      method: 'POST',
                      body: {
                        employeeId: loanForm.employeeId,
                        principalAmount: Number(loanForm.principalAmount),
                        monthlyDeduction: Number(loanForm.monthlyDeduction || 0),
                        notes: loanForm.notes.trim() || null,
                      },
                    });
                    setCreatingLoan(false);
                    setLoanForm({ employeeId: '', principalAmount: '', monthlyDeduction: '', notes: '' });
                  }, 'hr.loans.created')}>
                  {busy ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" className="ae-btn-ghost" onClick={() => setCreatingLoan(false)}>{t('common.cancel')}</button>
              </div>
            </Panel>
          )}

          <Panel title={t('hr.tab.loans')}>
            {loans.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">{t('common.noResults')}</p>
            ) : (
              <div className="ae-table-wrap">
                <table className="ae-table ae-table--rows">
                  <thead>
                    <tr>
                      <th>{t('hr.loans.employee')}</th>
                      <th>{t('hr.loans.date')}</th>
                      <th>{t('hr.loans.principal')}</th>
                      <th>{t('hr.loans.repaid')}</th>
                      <th>{t('hr.loans.remaining')}</th>
                      <th>{t('hr.loans.monthly')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((l) => (
                      <tr key={l.id} className={l.remainingAmount > 0 ? undefined : 'opacity-60'}>
                        <td>
                          <span className="font-bold">{l.employeeName}</span>
                          {l.notes && <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{l.notes}</span>}
                        </td>
                        <td dir="ltr">{l.loanDate}</td>
                        <td>{money(l.principalAmount)}</td>
                        <td>{l.repaidAmount > 0 ? money(l.repaidAmount) : '—'}</td>
                        <td className={l.remainingAmount > 0 ? 'ae-stat-value--warn' : undefined}>
                          {l.remainingAmount > 0 ? money(l.remainingAmount) : '—'}
                        </td>
                        <td>{l.monthlyDeduction > 0 ? money(l.monthlyDeduction) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
