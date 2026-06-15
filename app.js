import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "prestapp-dashboard-v2";
const SELECTED_LOAN_KEY = "prestapp-selected-loan";
const SELECTED_INSTALLMENT_KEY = "prestapp-selected-installment";
const OLD_STORAGE_KEY = "control-prestamos-v1";
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const DEMO_LOANS = [
  ["Juan Perez", "3001234567", 500000],
  ["Ana Gomez", "3007654321", 300000],
  ["Luis Diaz", "3011122233", 800000],
  ["Maria Lopez", "3022233344", 400000],
  ["Carlos Ruiz", "3033344455", 600000],
];

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

const q = (id) => document.getElementById(id);
const page = document.body.dataset.page || "dashboard";
const todayIso = toIsoDate(new Date());

let state = loadState();
let activeFilter = new URLSearchParams(window.location.search).get("filter") || "all";
let selectedLoanId = localStorage.getItem(SELECTED_LOAN_KEY) || state.loans[0]?.id || "";
let syncTimer = null;
let supabaseSchemaReady = Boolean(supabase);

if (!state.loans.some((loan) => loan.id === selectedLoanId)) {
  selectedLoanId = state.loans[0]?.id || "";
}
localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
localStorage.setItem(SELECTED_LOAN_KEY, selectedLoanId);

init();

function init() {
  bindShell();
  bindSearch();
  bindFilters();
  bindLoanForm();
  bindLoansTable();
  bindInstallmentsTable();
  bindClientsTable();
  bindPaymentForm();
  bindEditForm();
  bindExport();
  renderAll();
  loadRemoteState();
}

function bindShell() {
  q("menuToggle")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });
}

function bindSearch() {
  q("searchInput")?.addEventListener("input", () => {
    renderLoansTable();
    renderClientsTable();
  });
}

function bindFilters() {
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === activeFilter);
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((item) => {
        item.classList.toggle("active", item.dataset.filter === activeFilter);
      });
      renderLoansTable();
    });
  });
}

function bindLoanForm() {
  const form = q("loanForm");
  if (!form) return;

  q("startDate").value = todayIso;
  ["input", "change"].forEach((eventName) => form.addEventListener(eventName, updatePreview));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const loan = createLoanFromForm();
    state.loans.unshift(loan);
    selectedLoanId = loan.id;
    localStorage.setItem(SELECTED_LOAN_KEY, selectedLoanId);
    saveState();
    showToast("Prestamo guardado");
    window.location.href = "/prestamos.html";
  });
  updatePreview();
}

function bindLoansTable() {
  q("recentLoansBody")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const loan = state.loans.find((item) => item.id === button.dataset.loanId);
    if (!loan) return;

    if (button.dataset.action === "view-loan") {
      selectLoan(loan.id);
      renderSelectedLoan();
    }

    if (button.dataset.action === "edit-loan") {
      openEditDialog(loan);
    }

    if (button.dataset.action === "pay-loan") {
      selectLoan(loan.id);
      window.location.href = "/pagos.html";
    }

    if (button.dataset.action === "delete-loan") {
      const ok = window.confirm(`Eliminar el prestamo de ${loan.borrower}?`);
      if (!ok) return;
      state.loans = state.loans.filter((item) => item.id !== loan.id);
      deleteRemoteLoans([loan.id]);
      selectLoan(state.loans[0]?.id || "");
      saveState();
      renderAll();
      showToast("Prestamo eliminado");
    }
  });

  q("editSelectedLoanBtn")?.addEventListener("click", () => {
    const loan = getSelectedLoan();
    if (loan) openEditDialog(loan);
  });
}

function bindInstallmentsTable() {
  q("installmentsBody")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='pay-installment']");
    if (!button) return;
    selectLoan(button.dataset.loanId);
    localStorage.setItem(SELECTED_INSTALLMENT_KEY, button.dataset.installmentId);
    window.location.href = "/pagos.html";
  });
}

function bindClientsTable() {
  q("clientsBody")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    if (button.dataset.action === "view-client") {
      selectLoan(button.dataset.loanId);
      window.location.href = "/prestamos.html";
    }

    if (button.dataset.action === "delete-client") {
      deleteClient(button.dataset.clientKey, button.dataset.clientName);
    }
  });
}

function bindPaymentForm() {
  const form = q("paymentForm");
  if (!form) return;

  q("paymentDate").value = todayIso;
  q("paymentLoanSelect")?.addEventListener("change", () => {
    selectLoan(q("paymentLoanSelect").value);
    renderPaymentForm();
  });
  q("paymentInstallmentSelect")?.addEventListener("change", fillSelectedInstallmentAmount);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const loan = state.loans.find((item) => item.id === q("paymentLoanSelect").value);
    const installmentId = q("paymentInstallmentSelect").value;
    const amount = numberFrom(q("paymentAmount").value);
    if (!loan || !installmentId || amount <= 0) {
      showToast("No hay cuota pendiente para registrar");
      return;
    }

    const applied = applyPayment(loan, installmentId, amount, {
      date: q("paymentDate").value || todayIso,
      method: q("paymentMethod").value,
      note: q("paymentNote").value.trim(),
    });

    selectLoan(loan.id);
    localStorage.removeItem(SELECTED_INSTALLMENT_KEY);
    saveState();
    renderAll();
    showToast(`Pago registrado por ${formatMoney(applied)}`);
  });
}

function bindEditForm() {
  const form = q("editLoanForm");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      closeEditDialog();
      return;
    }

    const loan = state.loans.find((item) => item.id === q("editLoanId").value);
    if (!loan) return;

    updateLoanFromEditForm(loan);
    selectLoan(loan.id);
    saveState();
    renderAll();
    closeEditDialog();
    showToast("Prestamo actualizado");
  });
}

function bindExport() {
  q("exportBtn")?.addEventListener("click", exportCsv);
}

function renderAll() {
  renderMetrics();
  renderLoansTable();
  renderClientsTable();
  renderChart();
  renderSelectedLoan();
  renderPaymentForm();
}

function renderMetrics() {
  if (!q("metricCapital")) return;
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

  q("metricCapital").textContent = formatMoney(totals.capital);
  q("metricInterest").textContent = formatMoney(totals.interest);
  q("metricPaid").textContent = formatMoney(totals.paid);
  q("metricPending").textContent = formatMoney(totals.pending);
  q("metricActive").textContent = totals.active;
  q("metricOverdue").textContent = totals.overdue;
  q("metricUpcoming").textContent = totals.upcoming;
}

function renderLoansTable() {
  const body = q("recentLoansBody");
  if (!body) return;
  const query = q("searchInput")?.value.trim().toLowerCase() || "";
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

  body.innerHTML = loans.map((loan) => {
    const summary = getLoanSummary(loan);
    const status = getLoanStatus(loan);
    const actions =
      page === "dashboard"
        ? ""
        : `<td><div class="row-actions">
            <button class="icon-action" type="button" data-action="view-loan" data-loan-id="${loan.id}">VER</button>
            <button class="icon-action" type="button" data-action="edit-loan" data-loan-id="${loan.id}">EDIT</button>
            <button class="icon-action" type="button" data-action="pay-loan" data-loan-id="${loan.id}" ${summary.remaining <= 0 ? "disabled" : ""}>PG</button>
            <button class="icon-action danger" type="button" data-action="delete-loan" data-loan-id="${loan.id}">DEL</button>
          </div></td>`;

    return `
      <tr>
        <td>${escapeHtml(loan.borrower)}</td>
        <td>${formatMoney(loan.amount)}</td>
        <td>${loan.interestRate}%</td>
        <td>${formatMoney(summary.total)}</td>
        <td>${formatMoney(summary.paid)}</td>
        <td>${formatMoney(summary.remaining)}</td>
        <td><span class="status-pill ${status.className}">${status.label}</span></td>
        ${actions}
      </tr>
    `;
  }).join("");
}

function renderClientsTable() {
  const body = q("clientsBody");
  if (!body) return;
  const query = q("searchInput")?.value.trim().toLowerCase() || "";
  const clients = getClients().filter((client) => `${client.name} ${client.phone}`.toLowerCase().includes(query));

  if (!clients.length) {
    body.innerHTML = `<tr><td class="empty-state" colspan="7">No hay clientes para mostrar.</td></tr>`;
    return;
  }

  body.innerHTML = clients.map((client) => `
    <tr>
      <td>${escapeHtml(client.name)}</td>
      <td>${escapeHtml(client.phone || "Sin celular")}</td>
      <td>${client.loanCount}</td>
      <td>${formatMoney(client.totalAmount)}</td>
      <td>${formatMoney(client.pending)}</td>
      <td><span class="status-pill ${client.status.className}">${client.status.label}</span></td>
      <td><div class="row-actions">
        <button class="icon-action" type="button" data-action="view-client" data-loan-id="${client.firstLoanId}">VER</button>
        <button class="icon-action danger" type="button" data-action="delete-client" data-client-key="${escapeHtml(client.key)}" data-client-name="${escapeHtml(client.name)}">DEL</button>
      </div></td>
    </tr>
  `).join("");
}

function renderChart() {
  const donut = q("chartDonut");
  if (!donut) return;
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
  const activeEnd = paidPct + activePct;

  donut.style.background =
    state.loans.length === 0
      ? "#e7ebf3"
      : `conic-gradient(var(--green) 0 ${paidPct}%, var(--purple) ${paidPct}% ${activeEnd}%, var(--red) ${activeEnd}% 100%)`;
  q("chartTotal").textContent = state.loans.length;
  q("legendPaid").textContent = `${counts.closed} (${paidPct}%)`;
  q("legendActive").textContent = `${counts.active} (${activePct}%)`;
  q("legendOverdue").textContent = `${counts.overdue} (${overduePct}%)`;
}

function renderSelectedLoan() {
  const summaryBox = q("selectedSummary");
  const body = q("installmentsBody");
  if (!summaryBox || !body) return;
  const loan = getSelectedLoan() || state.loans[0];

  if (!loan) {
    q("selectedTitle").textContent = "Cuotas del prestamo";
    summaryBox.innerHTML = "";
    body.innerHTML = `<tr><td class="empty-state" colspan="6">No hay prestamos registrados.</td></tr>`;
    q("editSelectedLoanBtn").disabled = true;
    return;
  }

  selectLoan(loan.id);
  const summary = getLoanSummary(loan);
  const lastDue = loan.installments.at(-1)?.dueDate || loan.startDate;
  q("selectedTitle").textContent = `Cuotas del prestamo - ${loan.borrower}`;
  q("editSelectedLoanBtn").disabled = false;
  summaryBox.innerHTML = `
    <div><span>Monto</span><strong>${formatMoney(loan.amount)}</strong></div>
    <div><span>Interes</span><strong>${loan.interestRate}%</strong></div>
    <div><span>Total a cobrar</span><strong>${formatMoney(summary.total)}</strong></div>
    <div><span>Plazo</span><strong>${loan.termDays} dias</strong></div>
    <div><span>Vence</span><strong>${formatDate(lastDue)}</strong></div>
  `;

  body.innerHTML = loan.installments.map((installment) => {
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
        <td><button class="icon-action" type="button" data-action="pay-installment" data-loan-id="${loan.id}" data-installment-id="${installment.id}" ${isPaid ? "disabled" : ""}>PG</button></td>
      </tr>
    `;
  }).join("");
}

function renderPaymentForm() {
  const loanSelect = q("paymentLoanSelect");
  if (!loanSelect) return;
  const pendingLoans = state.loans.filter((loan) => getLoanSummary(loan).remaining > 0);
  const button = q("paymentForm")?.querySelector("button");

  if (!pendingLoans.length) {
    loanSelect.innerHTML = `<option value="">Sin prestamos pendientes</option>`;
    q("paymentInstallmentSelect").innerHTML = `<option value="">Sin cuotas</option>`;
    q("paymentAmount").value = "";
    if (button) button.disabled = true;
    return;
  }

  if (button) button.disabled = false;
  loanSelect.innerHTML = pendingLoans
    .map((loan) => `<option value="${loan.id}">${escapeHtml(loan.borrower)} - ${formatMoney(getLoanSummary(loan).remaining)}</option>`)
    .join("");

  const selectedLoan = pendingLoans.find((loan) => loan.id === selectedLoanId) || pendingLoans[0];
  loanSelect.value = selectedLoan.id;
  selectLoan(selectedLoan.id);

  const pendingInstallments = selectedLoan.installments.filter((item) => item.amount > item.paid);
  q("paymentInstallmentSelect").innerHTML = pendingInstallments
    .map((item) => `<option value="${item.id}">Cuota ${item.number} - ${formatMoney(item.amount - item.paid)}</option>`)
    .join("");

  const preferredInstallmentId = localStorage.getItem(SELECTED_INSTALLMENT_KEY);
  const installment = pendingInstallments.find((item) => item.id === preferredInstallmentId) || pendingInstallments[0];
  if (installment) {
    q("paymentInstallmentSelect").value = installment.id;
    q("paymentAmount").value = installment.amount - installment.paid;
    q("paymentAmount").max = getLoanSummary(selectedLoan).remaining;
  }
  q("paymentDate").value = todayIso;
}

function updatePreview() {
  if (!q("previewInterest")) return;
  const amount = numberFrom(q("amount").value);
  const rate = numberFrom(q("interestRate").value);
  const count = Math.max(1, Number(q("installmentsCount").value || 1));
  const totals = calculateTotals(amount, rate, count);
  q("previewInterest").textContent = formatMoney(totals.interest);
  q("previewTotal").textContent = formatMoney(totals.total);
  q("previewCount").textContent = count;
  q("previewInstallment").textContent = formatMoney(totals.installment);
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.loans)) return sanitizeState(parsed);
    } catch (error) {
      console.warn("No se pudo leer el respaldo local", error);
    }
  }

  const oldSaved = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldSaved) {
    try {
      const parsed = JSON.parse(oldSaved);
      if (Array.isArray(parsed.loans) && parsed.loans.length > 1) {
        return sanitizeState({ loans: parsed.loans.map(normalizeLoan) });
      }
    } catch (error) {
      console.warn("No se pudo migrar el respaldo anterior", error);
    }
  }

  return { loans: [] };
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

    state = sanitizeState({ loans: loans.map((loan) => fromDbLoan(loan, installments || [], payments || [])) });
    selectedLoanId = state.loans[0]?.id || "";
    localStorage.setItem(SELECTED_LOAN_KEY, selectedLoanId);
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
    syncAllToSupabase().catch((error) => handleSupabaseError(error, "guardar datos"));
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
  if (error) handleSupabaseError(error, "eliminar datos");
}

function createLoanFromForm() {
  const amount = numberFrom(q("amount").value);
  const interestRate = numberFrom(q("interestRate").value);
  const termDays = Number(q("termDays").value);
  const installmentsCount = Math.max(1, Number(q("installmentsCount").value));
  const startDate = q("startDate").value || todayIso;
  const totals = calculateTotals(amount, interestRate, installmentsCount);
  return {
    id: uid(),
    borrower: q("borrower").value.trim(),
    phone: q("phone").value.trim(),
    amount,
    interestRate,
    termDays,
    installmentsCount,
    startDate,
    paymentFrequency: q("paymentFrequency").value,
    notes: "",
    installments: buildSchedule(totals.total, installmentsCount, startDate, termDays),
    payments: [],
    createdAt: new Date().toISOString(),
  };
}

function calculateTotals(amount, interestRate, installmentsCount) {
  const interest = Math.round(amount * (interestRate / 100));
  const total = amount + interest;
  const installment = Math.ceil(total / Math.max(1, installmentsCount));
  return { interest, total, installment };
}

function buildSchedule(total, count, startDate, termDays) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: uid(),
      number,
      dueDate: addDays(startDate, Math.round((termDays / count) * number)),
      amount: number === count ? total - base * (count - 1) : base,
      paid: 0,
      paidDate: "",
    };
  });
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

function sanitizeState(value) {
  const loans = Array.isArray(value.loans) ? value.loans.filter((loan) => !isDemoLoan(loan)) : [];
  return { ...value, loans };
}

function isDemoLoan(loan) {
  return DEMO_LOANS.some(([borrower, phone, amount]) => {
    return loan.borrower === borrower && loan.phone === phone && Number(loan.amount) === amount;
  });
}

function openEditDialog(loan) {
  q("editLoanId").value = loan.id;
  q("editBorrower").value = loan.borrower;
  q("editPhone").value = loan.phone || "";
  q("editAmount").value = loan.amount;
  q("editInterestRate").value = loan.interestRate;
  q("editTermDays").value = loan.termDays;
  q("editPaymentFrequency").value = loan.paymentFrequency || "Quincenal";
  q("editInstallmentsCount").value = loan.installmentsCount || loan.installments.length || 1;
  q("editStartDate").value = loan.startDate || todayIso;
  q("editLoanDialog").showModal();
}

function closeEditDialog() {
  q("editLoanDialog")?.close();
}

function updateLoanFromEditForm(loan) {
  const totalPaid = getLoanSummary(loan).paid;
  const lastPayment = loan.payments[loan.payments.length - 1];
  const lastPaidInstallment = [...loan.installments].reverse().find((item) => item.paidDate);
  const lastPaymentDate = lastPayment?.date || lastPaidInstallment?.paidDate || todayIso;
  const amount = numberFrom(q("editAmount").value);
  const interestRate = numberFrom(q("editInterestRate").value);
  const termDays = Number(q("editTermDays").value);
  const installmentsCount = Math.max(1, Number(q("editInstallmentsCount").value));
  const startDate = q("editStartDate").value || todayIso;
  const totals = calculateTotals(amount, interestRate, installmentsCount);

  loan.borrower = q("editBorrower").value.trim();
  loan.phone = q("editPhone").value.trim();
  loan.amount = amount;
  loan.interestRate = interestRate;
  loan.termDays = termDays;
  loan.installmentsCount = installmentsCount;
  loan.startDate = startDate;
  loan.paymentFrequency = q("editPaymentFrequency").value;
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
    if (installment.paid >= installment.amount) installment.paidDate = paidDate;
  });
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
    if (installment.paid >= installment.amount) installment.paidDate = details.date;
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

function fillSelectedInstallmentAmount() {
  const loan = state.loans.find((item) => item.id === q("paymentLoanSelect").value);
  const installment = loan?.installments.find((item) => item.id === q("paymentInstallmentSelect").value);
  if (!installment) return;
  q("paymentAmount").value = Math.max(0, installment.amount - installment.paid);
}

function deleteClient(clientKey, clientName) {
  const loansToDelete = state.loans.filter((loan) => getClientKey(loan) === clientKey);
  if (!loansToDelete.length) return;
  const ok = window.confirm(`Eliminar el cliente ${clientName} y sus ${loansToDelete.length} prestamo(s)?`);
  if (!ok) return;
  state.loans = state.loans.filter((loan) => getClientKey(loan) !== clientKey);
  deleteRemoteLoans(loansToDelete.map((loan) => loan.id));
  selectLoan(state.loans[0]?.id || "");
  saveState();
  renderAll();
  showToast("Cliente eliminado");
}

function getLoanSummary(loan) {
  const interest = Math.round(loan.amount * (loan.interestRate / 100));
  const total = loan.amount + interest;
  const paid = loan.installments.reduce((sum, item) => sum + Number(item.paid || 0), 0);
  return { interest, total, paid, remaining: Math.max(0, total - paid) };
}

function getLoanStatus(loan) {
  const summary = getLoanSummary(loan);
  if (summary.remaining <= 0) return { key: "closed", label: "Pagado", className: "status-closed" };
  const hasOverdue = loan.installments.some((item) => item.amount > item.paid && item.dueDate < todayIso);
  if (hasOverdue) return { key: "overdue", label: "En mora", className: "status-overdue" };
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

function selectLoan(loanId) {
  selectedLoanId = loanId;
  if (loanId) localStorage.setItem(SELECTED_LOAN_KEY, loanId);
}

function getSelectedLoan() {
  return state.loans.find((item) => item.id === selectedLoanId);
}

function exportCsv() {
  const type = q("exportType")?.value || "Todos los prestamos";
  const rows = getLoansForExport(type).map((loan) => {
    const summary = getLoanSummary(loan);
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
      getLoanStatus(loan).label,
    ];
  });

  const header = ["Cliente", "Celular", "Monto", "Interes", "Total a cobrar", "Pagado", "Saldo", "Plazo dias", "Forma de pago", "Estado"];
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
  const filters = { "Solo activos": "active", "Solo en mora": "overdue", "Solo pagados": "closed" };
  const status = filters[type];
  if (!status) return state.loans;
  return state.loans.filter((loan) => getLoanStatus(loan).key === status);
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

function handleSupabaseError(error, action) {
  const message = getSupabaseErrorMessage(error);
  if (isMissingSupabaseTable(error)) supabaseSchemaReady = false;
  console.warn(`Supabase: no se pudo ${action}. ${message}`, error);
  showToast(message);
}

function getSupabaseErrorMessage(error) {
  if (isMissingSupabaseTable(error)) return "Faltan tablas en Supabase: ejecuta supabase/schema.sql";
  if (error?.message) return `Supabase: ${error.message}`;
  return "Supabase no respondio; usando respaldo local";
}

function isMissingSupabaseTable(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return error?.status === 404 || text.includes("PGRST205") || text.includes("schema cache");
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
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
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

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function showToast(message) {
  const toast = q("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}
