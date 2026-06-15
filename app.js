import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "prestapp-dashboard-v2";
const OLD_STORAGE_KEY = "control-prestamos-v1";
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const shortDate = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const byId = (id) => document.getElementById(id);
const todayIso = toIsoDate(new Date());

const elements = {
  sidebar: byId("sidebar"),
  menuToggle: byId("menuToggle"),
  moduleTitle: byId("moduleTitle"),
  moduleSubtitle: byId("moduleSubtitle"),
  moduleActionBtn: byId("moduleActionBtn"),
  searchInput: byId("searchInput"),
  loanForm: byId("loanForm"),
  borrower: byId("borrower"),
  phone: byId("phone"),
  amount: byId("amount"),
  interestRate: byId("interestRate"),
  termDays: byId("termDays"),
  paymentFrequency: byId("paymentFrequency"),
  installmentsCount: byId("installmentsCount"),
  startDate: byId("startDate"),
  paymentForm: byId("paymentForm"),
  paymentLoanSelect: byId("paymentLoanSelect"),
  paymentInstallmentSelect: byId("paymentInstallmentSelect"),
  paymentAmount: byId("paymentAmount"),
  paymentDate: byId("paymentDate"),
  paymentMethod: byId("paymentMethod"),
  paymentNote: byId("paymentNote"),
  editSelectedLoanBtn: byId("editSelectedLoanBtn"),
  editLoanDialog: byId("editLoanDialog"),
  editLoanForm: byId("editLoanForm"),
  editLoanId: byId("editLoanId"),
  editBorrower: byId("editBorrower"),
  editPhone: byId("editPhone"),
  editAmount: byId("editAmount"),
  editInterestRate: byId("editInterestRate"),
  editTermDays: byId("editTermDays"),
  editPaymentFrequency: byId("editPaymentFrequency"),
  editInstallmentsCount: byId("editInstallmentsCount"),
  editStartDate: byId("editStartDate"),
  toast: byId("toast"),
};

const moduleConfig = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Resumen general de cartera y estado del negocio",
    actionLabel: "Nuevo prestamo",
    actionModule: "newLoan",
  },
  loans: {
    title: "Prestamos",
    subtitle: "Administra prestamos, cuotas, fechas y estados",
    actionLabel: "Nuevo prestamo",
    actionModule: "newLoan",
  },
  newLoan: {
    title: "Nuevo prestamo",
    subtitle: "Registra un cliente, calcula ganancia y crea el calendario de cuotas",
    actionLabel: "Ver prestamos",
    actionModule: "loans",
  },
  clients: {
    title: "Clientes",
    subtitle: "Consulta, revisa y elimina clientes de la cartera",
    actionLabel: "Nuevo cliente",
    actionModule: "newLoan",
  },
  payments: {
    title: "Pagos",
    subtitle: "Registra pagos por cliente y por cuota",
    actionLabel: "Ver prestamos",
    actionModule: "loans",
  },
  reports: {
    title: "Reportes",
    subtitle: "Exporta datos y revisa formulas de cobro",
    actionLabel: "Exportar Excel",
    actionModule: "",
  },
  settings: {
    title: "Configuracion",
    subtitle: "Estado de base de datos, plazos y respaldo local",
    actionLabel: "Ir al dashboard",
    actionModule: "dashboard",
  },
};

let state = loadState();
let activeFilter = "all";
let selectedLoanId = state.loans[0]?.id || "";
let syncTimer = null;
let supabaseSchemaReady = Boolean(supabase);

elements.startDate.value = todayIso;
elements.paymentDate.value = todayIso;

renderAll();
updatePreview();
setActiveModule("dashboard");
loadRemoteState();

elements.menuToggle.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

elements.moduleActionBtn.addEventListener("click", () => {
  if (document.body.dataset.activeModule === "reports") {
    exportCsv();
  }
});

document.addEventListener("click", (event) => {
  const moduleButton = event.target.closest("[data-module]");
  if (moduleButton) {
    setActiveModule(moduleButton.dataset.module);
  }

  const jumpButton = event.target.closest("[data-jump]");
  if (jumpButton) {
    jumpTo(jumpButton.dataset.jump);
  }

  const filterJump = event.target.closest("[data-module-filter]");
  if (filterJump) {
    setFilter(filterJump.dataset.moduleFilter);
    setActiveModule("loans");
  }
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

elements.searchInput.addEventListener("input", () => {
  renderLoansTable();
  renderClientsTable();
});

["input", "change"].forEach((eventName) => {
  elements.loanForm.addEventListener(eventName, updatePreview);
});

elements.loanForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const loan = createLoanFromForm();
  state.loans.unshift(loan);
  selectedLoanId = loan.id;
  saveState();
  resetLoanForm();
  renderAll();
  updatePreview();
  showToast("Prestamo guardado");
  jumpTo("loanDetailPanel");
});

byId("recentLoansBody").addEventListener("click", handleLoanTableClick);
byId("installmentsBody").addEventListener("click", handleInstallmentClick);
byId("clientsBody").addEventListener("click", handleClientTableClick);

elements.editSelectedLoanBtn.addEventListener("click", () => {
  const loan = state.loans.find((item) => item.id === selectedLoanId);
  if (loan) openEditDialog(loan);
});

elements.paymentLoanSelect.addEventListener("change", () => {
  selectedLoanId = elements.paymentLoanSelect.value;
  renderPaymentForm(selectedLoanId);
  renderSelectedLoan();
});

elements.paymentInstallmentSelect.addEventListener("change", fillSelectedInstallmentAmount);

elements.paymentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const loan = state.loans.find((item) => item.id === elements.paymentLoanSelect.value);
  const installmentId = elements.paymentInstallmentSelect.value;
  const amount = numberFrom(elements.paymentAmount.value);

  if (!loan || !installmentId || amount <= 0) {
    showToast("No hay cuota pendiente para registrar");
    return;
  }

  const applied = applyPayment(loan, installmentId, amount, {
    date: elements.paymentDate.value || todayIso,
    method: elements.paymentMethod.value,
    note: elements.paymentNote.value.trim(),
  });

  selectedLoanId = loan.id;
  saveState();
  renderAll();
  showToast(`Pago registrado por ${formatMoney(applied)}`);
});

elements.editLoanForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (event.submitter?.value === "cancel") {
    closeEditDialog();
    return;
  }

  const loan = state.loans.find((item) => item.id === elements.editLoanId.value);
  if (!loan) return;

  updateLoanFromEditForm(loan);
  selectedLoanId = loan.id;
  saveState();
  renderAll();
  closeEditDialog();
  showToast("Prestamo actualizado");
});

byId("exportBtn").addEventListener("click", exportCsv);
byId("sidebarExportBtn").addEventListener("click", () => setActiveModule("reports"));

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.loans)) return parsed;
    } catch (error) {
      console.warn("No se pudo leer el respaldo local", error);
    }
  }

  const oldSaved = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldSaved) {
    try {
      const parsed = JSON.parse(oldSaved);
      if (Array.isArray(parsed.loans) && parsed.loans.length > 1) {
        return { loans: parsed.loans.map(normalizeLoan) };
      }
    } catch (error) {
      console.warn("No se pudo migrar el respaldo anterior", error);
    }
  }

  return createSeedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueRemoteSave();
}

async function loadRemoteState() {
  if (!supabase) return;

  try {
    const { data: loans, error: loansError } = await supabase
      .from("loans")
      .select("*")
      .order("created_at", { ascending: false });

    if (loansError) throw loansError;

    if (!loans?.length) {
      await syncAllToSupabase();
      showToast("Supabase conectado");
      return;
    }

    const loanIds = loans.map((loan) => loan.id);
    const [{ data: installments, error: installmentsError }, { data: payments, error: paymentsError }] =
      await Promise.all([
        supabase.from("installments").select("*").in("loan_id", loanIds).order("number", { ascending: true }),
        supabase.from("payments").select("*").in("loan_id", loanIds).order("date", { ascending: true }),
      ]);

    if (installmentsError) throw installmentsError;
    if (paymentsError) throw paymentsError;

    state = {
      loans: loans.map((loan) => fromDbLoan(loan, installments || [], payments || [])),
    };

    selectedLoanId = state.loans[0]?.id || "";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
    showToast("Datos cargados de Supabase");
  } catch (error) {
    handleSupabaseError(error, "cargar datos");
  }
}

function queueRemoteSave() {
  if (!supabase || !supabaseSchemaReady) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncAllToSupabase().catch((error) => {
      handleSupabaseError(error, "guardar datos");
    });
  }, 400);
}

async function syncAllToSupabase() {
  if (!supabase) return;

  if (!state.loans.length) {
    await supabase.from("payments").delete().neq("id", "__none__");
    await supabase.from("installments").delete().neq("id", "__none__");
    await supabase.from("loans").delete().neq("id", "__none__");
    return;
  }

  const dbLoans = state.loans.map(toDbLoan);
  const loanIds = dbLoans.map((loan) => loan.id);
  const dbInstallments = state.loans.flatMap((loan) => loan.installments.map((item) => toDbInstallment(item, loan.id)));
  const dbPayments = state.loans.flatMap((loan) => loan.payments.map((item) => toDbPayment(item, loan.id)));

  const { error: loansError } = await supabase.from("loans").upsert(dbLoans);
  if (loansError) throw loansError;

  const { error: installmentsDeleteError } = await supabase.from("installments").delete().in("loan_id", loanIds);
  if (installmentsDeleteError) throw installmentsDeleteError;

  const { error: paymentsDeleteError } = await supabase.from("payments").delete().in("loan_id", loanIds);
  if (paymentsDeleteError) throw paymentsDeleteError;

  if (dbInstallments.length) {
    const { error } = await supabase.from("installments").insert(dbInstallments);
    if (error) throw error;
  }

  if (dbPayments.length) {
    const { error } = await supabase.from("payments").insert(dbPayments);
    if (error) throw error;
  }
}

async function deleteRemoteLoans(loanIds) {
  if (!supabase || !loanIds.length) return;
  const { error } = await supabase.from("loans").delete().in("id", loanIds);
  if (error) {
    handleSupabaseError(error, "eliminar datos");
  }
}

function handleSupabaseError(error, action) {
  const message = getSupabaseErrorMessage(error);
  if (isMissingSupabaseTable(error)) {
    supabaseSchemaReady = false;
  }
  console.warn(`Supabase: no se pudo ${action}. ${message}`, error);
  showToast(message);
}

function getSupabaseErrorMessage(error) {
  if (isMissingSupabaseTable(error)) {
    return "Faltan tablas en Supabase: ejecuta supabase/schema.sql";
  }

  if (error?.message) {
    return `Supabase: ${error.message}`;
  }

  return "Supabase no respondio; usando respaldo local";
}

function isMissingSupabaseTable(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return error?.status === 404 || text.includes("PGRST205") || text.includes("schema cache");
}

function toDbLoan(loan) {
  return {
    id: loan.id,
    borrower: loan.borrower,
    phone: loan.phone,
    amount: loan.amount,
    interest_rate: loan.interestRate,
    term_days: loan.termDays,
    installments_count: loan.installmentsCount,
    start_date: loan.startDate,
    payment_frequency: loan.paymentFrequency,
    notes: loan.notes || "",
    created_at: loan.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toDbInstallment(installment, loanId) {
  return {
    id: installment.id,
    loan_id: loanId,
    number: installment.number,
    due_date: installment.dueDate,
    amount: installment.amount,
    paid: installment.paid,
    paid_date: installment.paidDate || null,
  };
}

function toDbPayment(payment, loanId) {
  return {
    id: payment.id,
    loan_id: loanId,
    amount: payment.amount,
    date: payment.date,
    method: payment.method || "",
    note: payment.note || "",
  };
}

function fromDbLoan(loan, installments, payments) {
  return {
    id: loan.id,
    borrower: loan.borrower,
    phone: loan.phone || "",
    amount: Number(loan.amount || 0),
    interestRate: Number(loan.interest_rate || 0),
    termDays: Number(loan.term_days || 30),
    installmentsCount: Number(loan.installments_count || 1),
    startDate: loan.start_date,
    paymentFrequency: loan.payment_frequency || "Quincenal",
    notes: loan.notes || "",
    installments: installments.filter((item) => item.loan_id === loan.id).map(fromDbInstallment),
    payments: payments.filter((item) => item.loan_id === loan.id).map(fromDbPayment),
    createdAt: loan.created_at || new Date().toISOString(),
  };
}

function fromDbInstallment(installment) {
  return {
    id: installment.id,
    number: Number(installment.number || 0),
    dueDate: installment.due_date,
    amount: Number(installment.amount || 0),
    paid: Number(installment.paid || 0),
    paidDate: installment.paid_date || "",
  };
}

function fromDbPayment(payment) {
  return {
    id: payment.id,
    amount: Number(payment.amount || 0),
    date: payment.date,
    method: payment.method || "",
    note: payment.note || "",
  };
}

function createSeedState() {
  const loans = [
    seedLoan({
      borrower: "Juan Perez",
      phone: "3001234567",
      amount: 500000,
      interestRate: 10,
      termDays: 45,
      installmentsCount: 4,
      startDate: "2026-06-01",
      paymentFrequency: "Quincenal",
      paid: 137500,
      paidDate: "2026-06-12",
    }),
    seedLoan({
      borrower: "Ana Gomez",
      phone: "3007654321",
      amount: 300000,
      interestRate: 15,
      termDays: 30,
      installmentsCount: 3,
      startDate: "2026-05-06",
      paymentFrequency: "Semanal",
      paid: 345000,
      paidDate: "2026-06-04",
    }),
    seedLoan({
      borrower: "Luis Diaz",
      phone: "3011122233",
      amount: 800000,
      interestRate: 10,
      termDays: 60,
      installmentsCount: 4,
      startDate: "2026-05-02",
      paymentFrequency: "Quincenal",
      paid: 200000,
      paidDate: "2026-05-18",
    }),
    seedLoan({
      borrower: "Maria Lopez",
      phone: "3022233344",
      amount: 400000,
      interestRate: 10,
      termDays: 30,
      installmentsCount: 3,
      startDate: "2026-06-10",
      paymentFrequency: "Semanal",
      paid: 0,
      paidDate: "",
    }),
    seedLoan({
      borrower: "Carlos Ruiz",
      phone: "3033344455",
      amount: 600000,
      interestRate: 15,
      termDays: 45,
      installmentsCount: 3,
      startDate: "2026-05-28",
      paymentFrequency: "Quincenal",
      paid: 230000,
      paidDate: "2026-06-08",
    }),
  ];

  return { loans };
}

function seedLoan(config) {
  const totals = calculateTotals(config.amount, config.interestRate, config.installmentsCount);
  const loan = {
    id: uid(),
    borrower: config.borrower,
    phone: config.phone,
    amount: config.amount,
    interestRate: config.interestRate,
    termDays: config.termDays,
    installmentsCount: config.installmentsCount,
    startDate: config.startDate,
    paymentFrequency: config.paymentFrequency,
    notes: "",
    installments: buildSchedule(totals.total, config.installmentsCount, config.startDate, config.termDays),
    payments: [],
    createdAt: new Date().toISOString(),
  };

  if (config.paid > 0) {
    applyPayment(loan, loan.installments[0].id, config.paid, {
      date: config.paidDate || config.startDate,
      method: "Carga inicial",
      note: "Pago de ejemplo",
    });
  }

  return loan;
}

function normalizeLoan(loan) {
  return {
    ...loan,
    paymentFrequency: loan.paymentFrequency || "Quincenal",
    payments: Array.isArray(loan.payments) ? loan.payments : [],
    installments: Array.isArray(loan.installments)
      ? loan.installments.map((item, index) => ({
          id: item.id || uid(),
          number: item.number || index + 1,
          dueDate: item.dueDate,
          amount: Number(item.amount || 0),
          paid: Number(item.paid || 0),
          paidDate: item.paidDate || "",
        }))
      : [],
  };
}

function createLoanFromForm() {
  const amount = numberFrom(elements.amount.value);
  const interestRate = numberFrom(elements.interestRate.value);
  const termDays = Number(elements.termDays.value);
  const installmentsCount = Math.max(1, Number(elements.installmentsCount.value));
  const totals = calculateTotals(amount, interestRate, installmentsCount);

  return {
    id: uid(),
    borrower: elements.borrower.value.trim(),
    phone: elements.phone.value.trim(),
    amount,
    interestRate,
    termDays,
    installmentsCount,
    startDate: elements.startDate.value || todayIso,
    paymentFrequency: elements.paymentFrequency.value,
    notes: "",
    installments: buildSchedule(totals.total, installmentsCount, elements.startDate.value || todayIso, termDays),
    payments: [],
    createdAt: new Date().toISOString(),
  };
}

function resetLoanForm() {
  elements.loanForm.reset();
  elements.amount.value = 500000;
  elements.interestRate.value = 10;
  elements.termDays.value = 45;
  elements.paymentFrequency.value = "Quincenal";
  elements.installmentsCount.value = 4;
  elements.startDate.value = todayIso;
}

function calculateTotals(amount, interestRate, installmentsCount) {
  const interest = Math.round(amount * (interestRate / 100));
  const total = amount + interest;
  const installment = Math.ceil(total / Math.max(1, installmentsCount));
  return { interest, total, installment };
}

function buildSchedule(total, count, startDate, termDays) {
  const base = Math.floor(total / count);
  const schedule = [];

  for (let index = 1; index <= count; index += 1) {
    const amount = index === count ? total - base * (count - 1) : base;
    const days = Math.round((termDays / count) * index);
    schedule.push({
      id: uid(),
      number: index,
      dueDate: addDays(startDate, days),
      amount,
      paid: 0,
      paidDate: "",
    });
  }

  return schedule;
}

function renderAll() {
  renderMetrics();
  renderLoansTable();
  renderClientsTable();
  renderChart();
  renderSelectedLoan();
  renderPaymentForm(selectedLoanId);
}

function renderMetrics() {
  const totals = state.loans.reduce(
    (acc, loan) => {
      const summary = getLoanSummary(loan);
      const status = getLoanStatus(loan);
      acc.capital += loan.amount;
      acc.interest += summary.interest;
      acc.paid += summary.paid;
      acc.pending += summary.remaining;
      if (status.key === "active") acc.active += 1;
      if (status.key === "overdue") acc.overdue += 1;
      acc.upcoming += countUpcomingInstallments(loan);
      return acc;
    },
    { capital: 0, interest: 0, paid: 0, pending: 0, active: 0, overdue: 0, upcoming: 0 }
  );

  byId("metricCapital").textContent = formatMoney(totals.capital);
  byId("metricInterest").textContent = formatMoney(totals.interest);
  byId("metricPaid").textContent = formatMoney(totals.paid);
  byId("metricPending").textContent = formatMoney(totals.pending);
  byId("metricActive").textContent = totals.active;
  byId("metricOverdue").textContent = totals.overdue;
  byId("metricUpcoming").textContent = totals.upcoming;
}

function renderLoansTable() {
  const body = byId("recentLoansBody");
  const query = elements.searchInput.value.trim().toLowerCase();
  const loans = state.loans.filter((loan) => {
    const status = getLoanStatus(loan);
    const matchesFilter = activeFilter === "all" || status.key === activeFilter;
    const matchesQuery = `${loan.borrower} ${loan.phone}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });

  if (!loans.length) {
    body.innerHTML = `<tr><td class="empty-state" colspan="8">No hay prestamos para este filtro.</td></tr>`;
    return;
  }

  body.innerHTML = loans
    .map((loan) => {
      const summary = getLoanSummary(loan);
      const status = getLoanStatus(loan);
      return `
        <tr>
          <td>${escapeHtml(loan.borrower)}</td>
          <td>${formatMoney(loan.amount)}</td>
          <td>${loan.interestRate}%</td>
          <td>${formatMoney(summary.total)}</td>
          <td>${formatMoney(summary.paid)}</td>
          <td>${formatMoney(summary.remaining)}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-action" type="button" data-action="view-loan" data-loan-id="${loan.id}">VER</button>
              <button class="icon-action" type="button" data-action="edit-loan" data-loan-id="${loan.id}">EDIT</button>
              <button class="icon-action" type="button" data-action="pay-loan" data-loan-id="${loan.id}" ${summary.remaining <= 0 ? "disabled" : ""}>PG</button>
              <button class="icon-action danger" type="button" data-action="delete-loan" data-loan-id="${loan.id}">DEL</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderClientsTable() {
  const body = byId("clientsBody");
  const query = elements.searchInput.value.trim().toLowerCase();
  const clients = getClients().filter((client) => {
    return `${client.name} ${client.phone}`.toLowerCase().includes(query);
  });

  if (!clients.length) {
    body.innerHTML = `<tr><td class="empty-state" colspan="7">No hay clientes para mostrar.</td></tr>`;
    return;
  }

  body.innerHTML = clients
    .map((client) => {
      return `
        <tr>
          <td>${escapeHtml(client.name)}</td>
          <td>${escapeHtml(client.phone || "Sin celular")}</td>
          <td>${client.loanCount}</td>
          <td>${formatMoney(client.totalAmount)}</td>
          <td>${formatMoney(client.pending)}</td>
          <td><span class="status-pill ${client.status.className}">${client.status.label}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-action" type="button" data-action="view-client" data-loan-id="${client.firstLoanId}">VER</button>
              <button class="icon-action danger" type="button" data-action="delete-client" data-client-key="${escapeHtml(client.key)}" data-client-name="${escapeHtml(client.name)}">DEL</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderChart() {
  const counts = state.loans.reduce(
    (acc, loan) => {
      const status = getLoanStatus(loan).key;
      if (status === "closed") acc.closed += 1;
      if (status === "active") acc.active += 1;
      if (status === "overdue") acc.overdue += 1;
      return acc;
    },
    { closed: 0, active: 0, overdue: 0 }
  );

  const total = state.loans.length || 1;
  const paidPct = Math.round((counts.closed / total) * 100);
  const activePct = Math.round((counts.active / total) * 100);
  const overduePct = Math.max(0, 100 - paidPct - activePct);
  const paidEnd = paidPct;
  const activeEnd = paidPct + activePct;

  byId("chartDonut").style.background =
    state.loans.length === 0
      ? "#e7ebf3"
      : `conic-gradient(var(--green) 0 ${paidEnd}%, var(--purple) ${paidEnd}% ${activeEnd}%, var(--red) ${activeEnd}% 100%)`;

  byId("chartTotal").textContent = state.loans.length;
  byId("legendPaid").textContent = `${counts.closed} (${paidPct}%)`;
  byId("legendActive").textContent = `${counts.active} (${activePct}%)`;
  byId("legendOverdue").textContent = `${counts.overdue} (${overduePct}%)`;
}

function renderSelectedLoan() {
  const loan = state.loans.find((item) => item.id === selectedLoanId) || state.loans[0];
  const summaryBox = byId("selectedSummary");
  const body = byId("installmentsBody");

  if (!loan) {
    byId("selectedTitle").textContent = "Cuotas del prestamo";
    summaryBox.innerHTML = "";
    body.innerHTML = `<tr><td class="empty-state" colspan="6">No hay prestamos registrados.</td></tr>`;
    elements.editSelectedLoanBtn.disabled = true;
    return;
  }

  selectedLoanId = loan.id;
  elements.editSelectedLoanBtn.disabled = false;
  const summary = getLoanSummary(loan);
  const firstDue = loan.installments[0]?.dueDate || loan.startDate;
  const lastDue = loan.installments.at(-1)?.dueDate || loan.startDate;

  byId("selectedTitle").textContent = `Cuotas del prestamo - ${loan.borrower}`;
  summaryBox.innerHTML = `
    <div><span>Monto</span><strong>${formatMoney(loan.amount)}</strong></div>
    <div><span>Interes</span><strong>${loan.interestRate}%</strong></div>
    <div><span>Total a cobrar</span><strong>${formatMoney(summary.total)}</strong></div>
    <div><span>Plazo</span><strong>${loan.termDays} dias</strong></div>
    <div><span>Vence</span><strong>${formatDate(lastDue || firstDue)}</strong></div>
  `;

  body.innerHTML = loan.installments
    .map((installment) => {
      const remaining = Math.max(0, installment.amount - installment.paid);
      const isPaid = remaining <= 0;
      const isOverdue = !isPaid && installment.dueDate < todayIso;
      const status = isPaid
        ? { label: "Pagada", className: "status-active" }
        : isOverdue
          ? { label: "En mora", className: "status-overdue" }
          : { label: "Pendiente", className: "status-closed" };

      return `
        <tr>
          <td>${installment.number}</td>
          <td>${formatDate(installment.dueDate)}</td>
          <td>${formatMoney(installment.amount)}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
          <td>${installment.paidDate ? formatDate(installment.paidDate) : "-"}</td>
          <td>
            <button class="icon-action" type="button" data-action="pay-installment" data-loan-id="${loan.id}" data-installment-id="${installment.id}" ${isPaid ? "disabled" : ""}>PG</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderPaymentForm(preferredLoanId = selectedLoanId, preferredInstallmentId = "") {
  const pendingLoans = state.loans.filter((loan) => getLoanSummary(loan).remaining > 0);
  const button = elements.paymentForm.querySelector("button");

  if (!pendingLoans.length) {
    elements.paymentLoanSelect.innerHTML = `<option value="">Sin prestamos pendientes</option>`;
    elements.paymentInstallmentSelect.innerHTML = `<option value="">Sin cuotas</option>`;
    elements.paymentAmount.value = "";
    button.disabled = true;
    return;
  }

  button.disabled = false;
  elements.paymentLoanSelect.innerHTML = pendingLoans
    .map((loan) => `<option value="${loan.id}">${escapeHtml(loan.borrower)} - ${formatMoney(getLoanSummary(loan).remaining)}</option>`)
    .join("");

  const selectedLoan =
    pendingLoans.find((loan) => loan.id === preferredLoanId) ||
    pendingLoans.find((loan) => loan.id === selectedLoanId) ||
    pendingLoans[0];

  elements.paymentLoanSelect.value = selectedLoan.id;

  const pendingInstallments = selectedLoan.installments.filter((item) => item.amount > item.paid);
  elements.paymentInstallmentSelect.innerHTML = pendingInstallments
    .map((item) => `<option value="${item.id}">Cuota ${item.number} - ${formatMoney(item.amount - item.paid)}</option>`)
    .join("");

  const selectedInstallment =
    pendingInstallments.find((item) => item.id === preferredInstallmentId) || pendingInstallments[0];

  if (selectedInstallment) {
    elements.paymentInstallmentSelect.value = selectedInstallment.id;
    elements.paymentAmount.value = selectedInstallment.amount - selectedInstallment.paid;
    elements.paymentAmount.max = getLoanSummary(selectedLoan).remaining;
  }

  elements.paymentDate.value = todayIso;
}

function updatePreview() {
  const amount = numberFrom(elements.amount.value);
  const rate = numberFrom(elements.interestRate.value);
  const count = Math.max(1, Number(elements.installmentsCount.value || 1));
  const totals = calculateTotals(amount, rate, count);

  byId("previewInterest").textContent = formatMoney(totals.interest);
  byId("previewTotal").textContent = formatMoney(totals.total);
  byId("previewCount").textContent = count;
  byId("previewInstallment").textContent = formatMoney(totals.installment);
}

function handleLoanTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const loanId = button.dataset.loanId;
  const loan = state.loans.find((item) => item.id === loanId);
  if (!loan) return;

  if (button.dataset.action === "view-loan") {
    selectedLoanId = loanId;
    renderSelectedLoan();
    renderPaymentForm(loanId);
    jumpTo("loanDetailPanel");
  }

  if (button.dataset.action === "pay-loan") {
    selectedLoanId = loanId;
    renderPaymentForm(loanId);
    renderSelectedLoan();
    jumpTo("paymentPanel");
  }

  if (button.dataset.action === "edit-loan") {
    openEditDialog(loan);
  }

  if (button.dataset.action === "delete-loan") {
    const ok = window.confirm(`Eliminar el prestamo de ${loan.borrower}?`);
    if (!ok) return;
    state.loans = state.loans.filter((item) => item.id !== loanId);
    deleteRemoteLoans([loanId]);
    selectedLoanId = state.loans[0]?.id || "";
    saveState();
    renderAll();
    showToast("Prestamo eliminado");
  }
}

function handleInstallmentClick(event) {
  const button = event.target.closest("button[data-action='pay-installment']");
  if (!button) return;

  selectedLoanId = button.dataset.loanId;
  renderPaymentForm(button.dataset.loanId, button.dataset.installmentId);
  jumpTo("paymentPanel");
}

function handleClientTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  if (button.dataset.action === "view-client") {
    selectedLoanId = button.dataset.loanId;
    renderSelectedLoan();
    renderPaymentForm(selectedLoanId);
    jumpTo("loanDetailPanel");
  }

  if (button.dataset.action === "delete-client") {
    deleteClient(button.dataset.clientKey, button.dataset.clientName);
  }
}

function openEditDialog(loan) {
  elements.editLoanId.value = loan.id;
  elements.editBorrower.value = loan.borrower;
  elements.editPhone.value = loan.phone || "";
  elements.editAmount.value = loan.amount;
  elements.editInterestRate.value = loan.interestRate;
  elements.editTermDays.value = loan.termDays;
  elements.editPaymentFrequency.value = loan.paymentFrequency || "Quincenal";
  elements.editInstallmentsCount.value = loan.installmentsCount || loan.installments.length || 1;
  elements.editStartDate.value = loan.startDate || todayIso;

  if (typeof elements.editLoanDialog.showModal === "function") {
    elements.editLoanDialog.showModal();
  } else {
    elements.editLoanDialog.setAttribute("open", "");
  }

  elements.editBorrower.focus();
}

function closeEditDialog() {
  if (typeof elements.editLoanDialog.close === "function") {
    elements.editLoanDialog.close();
  } else {
    elements.editLoanDialog.removeAttribute("open");
  }
}

function updateLoanFromEditForm(loan) {
  const totalPaid = getLoanSummary(loan).paid;
  const lastPayment = loan.payments[loan.payments.length - 1];
  const lastPaidInstallment = [...loan.installments].reverse().find((item) => item.paidDate);
  const lastPaymentDate = lastPayment?.date || lastPaidInstallment?.paidDate || todayIso;
  const amount = numberFrom(elements.editAmount.value);
  const interestRate = numberFrom(elements.editInterestRate.value);
  const termDays = Number(elements.editTermDays.value);
  const installmentsCount = Math.max(1, Number(elements.editInstallmentsCount.value));
  const startDate = elements.editStartDate.value || todayIso;
  const totals = calculateTotals(amount, interestRate, installmentsCount);

  loan.borrower = elements.editBorrower.value.trim();
  loan.phone = elements.editPhone.value.trim();
  loan.amount = amount;
  loan.interestRate = interestRate;
  loan.termDays = termDays;
  loan.installmentsCount = installmentsCount;
  loan.startDate = startDate;
  loan.paymentFrequency = elements.editPaymentFrequency.value;
  loan.installments = buildSchedule(totals.total, installmentsCount, startDate, termDays);

  applyPaidAmountToSchedule(loan, Math.min(totalPaid, totals.total), lastPaymentDate);
}

function applyPaidAmountToSchedule(loan, paidAmount, paidDate) {
  let remainingPaid = paidAmount;

  loan.installments.forEach((installment) => {
    if (remainingPaid <= 0) return;
    const applied = Math.min(installment.amount, remainingPaid);
    installment.paid = applied;
    remainingPaid -= applied;
    if (installment.paid >= installment.amount) {
      installment.paidDate = paidDate;
    }
  });
}

function deleteClient(clientKey, clientName) {
  const loansToDelete = state.loans.filter((loan) => getClientKey(loan) === clientKey);
  if (!loansToDelete.length) return;

  const ok = window.confirm(`Eliminar el cliente ${clientName} y sus ${loansToDelete.length} prestamo(s)?`);
  if (!ok) return;

  state.loans = state.loans.filter((loan) => getClientKey(loan) !== clientKey);
  deleteRemoteLoans(loansToDelete.map((loan) => loan.id));
  selectedLoanId = state.loans[0]?.id || "";
  saveState();
  renderAll();
  showToast("Cliente eliminado");
}

function fillSelectedInstallmentAmount() {
  const loan = state.loans.find((item) => item.id === elements.paymentLoanSelect.value);
  const installment = loan?.installments.find((item) => item.id === elements.paymentInstallmentSelect.value);
  if (!installment) return;
  elements.paymentAmount.value = Math.max(0, installment.amount - installment.paid);
}

function applyPayment(loan, installmentId, amount, details) {
  const startIndex = Math.max(0, loan.installments.findIndex((item) => item.id === installmentId));
  let remainingPayment = Math.min(amount, getLoanSummary(loan).remaining);
  const appliedTotal = remainingPayment;

  for (let index = startIndex; index < loan.installments.length; index += 1) {
    if (remainingPayment <= 0) break;
    const installment = loan.installments[index];
    const pending = Math.max(0, installment.amount - installment.paid);
    if (pending <= 0) continue;

    const applied = Math.min(pending, remainingPayment);
    installment.paid += applied;
    remainingPayment -= applied;

    if (installment.paid >= installment.amount) {
      installment.paidDate = details.date;
    }
  }

  loan.payments.push({
    id: uid(),
    amount: appliedTotal,
    date: details.date,
    method: details.method,
    note: details.note,
  });

  return appliedTotal;
}

function getLoanSummary(loan) {
  const interest = Math.round(loan.amount * (loan.interestRate / 100));
  const total = loan.amount + interest;
  const paid = loan.installments.reduce((sum, item) => sum + Number(item.paid || 0), 0);
  return {
    interest,
    total,
    paid,
    remaining: Math.max(0, total - paid),
  };
}

function getLoanStatus(loan) {
  const summary = getLoanSummary(loan);
  if (summary.remaining <= 0) {
    return { key: "closed", label: "Pagado", className: "status-closed" };
  }

  const hasOverdue = loan.installments.some((item) => item.amount > item.paid && item.dueDate < todayIso);
  if (hasOverdue) {
    return { key: "overdue", label: "En mora", className: "status-overdue" };
  }

  return { key: "active", label: "Activo", className: "status-active" };
}

function countUpcomingInstallments(loan) {
  const limit = addDays(todayIso, 7);
  return loan.installments.filter((item) => item.amount > item.paid && item.dueDate >= todayIso && item.dueDate <= limit).length;
}

function getClients() {
  const clients = new Map();

  state.loans.forEach((loan) => {
    const key = getClientKey(loan);
    const summary = getLoanSummary(loan);
    const current = clients.get(key) || {
      key,
      name: loan.borrower,
      phone: loan.phone,
      firstLoanId: loan.id,
      loanCount: 0,
      totalAmount: 0,
      pending: 0,
      hasOverdue: false,
      hasActive: false,
    };

    current.loanCount += 1;
    current.totalAmount += loan.amount;
    current.pending += summary.remaining;
    current.hasOverdue = current.hasOverdue || getLoanStatus(loan).key === "overdue";
    current.hasActive = current.hasActive || getLoanStatus(loan).key === "active";
    clients.set(key, current);
  });

  return Array.from(clients.values()).map((client) => {
    const status = client.hasOverdue
      ? { label: "En mora", className: "status-overdue" }
      : client.pending <= 0
        ? { label: "Pagado", className: "status-closed" }
        : { label: "Activo", className: "status-active" };
    return { ...client, status };
  });
}

function getClientKey(loan) {
  return `${loan.borrower}-${loan.phone}`.trim().toLowerCase();
}

function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  renderLoansTable();
}

function jumpTo(id) {
  const module = getModuleForTarget(id);
  if (module) {
    setActiveModule(module);
  }

  const target = byId(id);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  document.body.classList.remove("sidebar-open");
}

function setActiveModule(module) {
  const config = moduleConfig[module] || moduleConfig.dashboard;
  document.body.dataset.activeModule = moduleConfig[module] ? module : "dashboard";
  elements.moduleTitle.textContent = config.title;
  elements.moduleSubtitle.textContent = config.subtitle;
  elements.moduleActionBtn.textContent = config.actionLabel;

  if (config.actionModule) {
    elements.moduleActionBtn.dataset.module = config.actionModule;
  } else {
    delete elements.moduleActionBtn.dataset.module;
  }

  document.querySelectorAll(".nav-item[data-module], .mobile-tabbar button[data-module]").forEach((button) => {
    button.classList.toggle("active", button.dataset.module === document.body.dataset.activeModule);
  });

  document.body.classList.remove("sidebar-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getModuleForTarget(id) {
  const moduleByTarget = {
    dashboard: "dashboard",
    recentLoansPanel: "loans",
    loanDetailPanel: "loans",
    newLoanPanel: "newLoan",
    clientsPanel: "clients",
    paymentPanel: "payments",
    exportPanel: "reports",
    formulaPanel: "reports",
    settingsPanel: "settings",
  };

  return moduleByTarget[id] || "";
}

function exportCsv() {
  const type = byId("exportType").value;
  const rows = getLoansForExport(type).map((loan) => {
    const summary = getLoanSummary(loan);
    const status = getLoanStatus(loan).label;
    return [
      loan.borrower,
      loan.phone,
      loan.amount,
      `${loan.interestRate}%`,
      summary.total,
      summary.paid,
      summary.remaining,
      loan.termDays,
      loan.paymentFrequency,
      status,
    ];
  });

  const header = [
    "Cliente",
    "Celular",
    "Monto",
    "Interes",
    "Total a cobrar",
    "Pagado",
    "Saldo",
    "Plazo dias",
    "Forma de pago",
    "Estado",
  ];

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prestapp-${todayIso}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Reporte exportado");
}

function getLoansForExport(type) {
  const filters = {
    "Solo activos": "active",
    "Solo en mora": "overdue",
    "Solo pagados": "closed",
  };
  const status = filters[type];
  if (!status) return state.loans;
  return state.loans.filter((loan) => getLoanStatus(loan).key === status);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function numberFrom(value) {
  return Number(value || 0);
}

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  return shortDate.format(new Date(`${value}T00:00:00`));
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function uid() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2200);
}
