import { createClient } from "@supabase/supabase-js";
import { initializeApp } from "firebase/app";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  onRegistered,
  register as registerMessaging,
} from "firebase/messaging";

const STORAGE_KEY = "prestapp-dashboard-v2";
const SELECTED_LOAN_KEY = "prestapp-selected-loan";
const SELECTED_INSTALLMENT_KEY = "prestapp-selected-installment";
const OLD_STORAGE_KEY = "control-prestamos-v1";
const PENDING_SYNC_KEY = "prestapp-pending-sync";
const DELETED_LOANS_KEY = "prestapp-deleted-loans";
const LEGACY_DEMO_CUTOFF = "2026-06-15T16:14:48.000Z";
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.VITE_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const FIREBASE_CONFIG = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "",
};
const FIREBASE_VAPID_KEY = import.meta.env?.VITE_FIREBASE_VAPID_KEY || "";
const userAdminClient =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      })
    : null;
const LOGIN_PATH = "/login.html";
const USER_EMAIL_DOMAIN = "prestapp.local";
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

let currentUser = null;
let currentProfile = null;
let adminUsers = [];
let state = { loans: [] };
let activeFilter = new URLSearchParams(window.location.search).get("filter") || "all";
let selectedLoanId = "";
let syncTimer = null;
let supabaseSchemaReady = Boolean(supabase);
let deferredInstallPrompt = null;
let firebaseApp = null;
let firebaseMessaging = null;
let firebaseSupported = null;
let messagingRegisteredUnsubscribe = null;
let foregroundMessageUnsubscribe = null;

registerServiceWorker();
bindInstallApp();
init();

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelectorAll("[data-install-app]").forEach((button) => {
    button.hidden = true;
  });
});

function registerServiceWorker() {
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!("serviceWorker" in navigator) || isLocalhost) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("No se pudo instalar PrestApp como PWA", error);
      });
  });
}

function bindInstallApp() {
  if (isStandaloneApp()) return;
  const buttonHtml = '<button class="install-button" data-install-app type="button">Instalar app</button>';
  const topbar = document.querySelector(".topbar");
  const authForm = q("authForm");

  if (topbar && !topbar.querySelector("[data-install-app]")) {
    topbar.insertAdjacentHTML("beforeend", buttonHtml);
  }

  if (authForm && !document.querySelector(".auth-panel [data-install-app]")) {
    authForm.insertAdjacentHTML("afterend", buttonHtml);
  }

  document.querySelectorAll("[data-install-app]").forEach((button) => {
    button.addEventListener("click", handleInstallClick);
  });
}

async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }

  showToast("Chrome: menu > Agregar a pantalla principal");
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

async function init() {
  if (page === "login") {
    initLoginPage();
    return;
  }

  const sessionReady = await initAuthenticatedUser();
  if (!sessionReady) return;

  state = loadState();
  selectedLoanId = storageGet(SELECTED_LOAN_KEY) || state.loans[0]?.id || "";
  if (!state.loans.some((loan) => loan.id === selectedLoanId)) {
    selectedLoanId = state.loans[0]?.id || "";
  }
  storageSet(STORAGE_KEY, JSON.stringify(state));
  storageSet(SELECTED_LOAN_KEY, selectedLoanId);

  bindShell();
  bindNotifications();
  bindSearch();
  bindFilters();
  bindLoanForm();
  bindLoansTable();
  bindInstallmentsTable();
  bindClientsTable();
  bindPaymentForm();
  bindEditForm();
  bindUsersAdmin();
  bindExport();
  hydrateUserShell();
  renderAll();
  loadRemoteState();
  loadUsersAdmin();
}

async function initLoginPage() {
  const form = q("authForm");
  const submitButton = q("authSubmit");
  if (!supabase) {
    if (submitButton) submitButton.disabled = true;
    showToast("Falta configurar Supabase");
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showToast(getSupabaseErrorMessage(error));
    return;
  }

  if (data.session?.user) {
    currentUser = data.session.user;
    currentProfile = await loadCurrentProfile();
    if (currentProfile?.active) {
      goToNextPage();
      return;
    }
    await supabase.auth.signOut();
    currentUser = null;
    currentProfile = null;
  }

  bindAuthModeButtons();
  form?.addEventListener("submit", handleAuthSubmit);
}

async function initAuthenticatedUser() {
  if (!supabase) {
    redirectToLogin();
    return false;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    handleSupabaseError(error, "validar sesion");
    redirectToLogin();
    return false;
  }

  if (!data.session?.user) {
    redirectToLogin();
    return false;
  }

  currentUser = data.session.user;
  currentProfile = await loadCurrentProfile();
  if (!currentProfile?.active) {
    await supabase.auth.signOut();
    showToast("Usuario desactivado");
    redirectToLogin();
    return false;
  }

  if (page === "users" && !isSuperUser()) {
    window.location.href = "/index.html";
    return false;
  }

  return true;
}

function bindAuthModeButtons() {
  document.querySelectorAll("button[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  setAuthMode("login");
}

function setAuthMode(mode) {
  const isBootstrap = mode === "bootstrap";
  document.body.dataset.authMode = mode;
  document.querySelectorAll("button[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  q("authSubmit").textContent = isBootstrap ? "Crear super usuario" : "Entrar";
  q("authPassword").autocomplete = isBootstrap ? "new-password" : "current-password";
  q("authHint").textContent = isBootstrap
    ? "Crea el primer administrador del sistema."
    : "Accede con tu usuario y clave.";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const mode = document.body.dataset.authMode || "login";
  const username = normalizeUsername(q("authUsername").value);
  const password = q("authPassword").value;
  const submitButton = q("authSubmit");

  if (!username) {
    showToast("Escribe un usuario valido");
    return;
  }

  if (submitButton) submitButton.disabled = true;
  try {
    const email = emailForUsername(username);
    if (mode === "bootstrap") {
      const { data: hasProfiles, error: profileCheckError } = await supabase.rpc("has_profiles");
      if (profileCheckError) throw profileCheckError;
      if (hasProfiles) throw new Error("Ya existe un super usuario. Usa Entrar.");
    }

    const response =
      mode === "bootstrap"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (response.error) throw response.error;

    if (mode === "bootstrap") {
      if (!response.data.session?.user) {
        showToast("Desactiva confirmacion de email en Supabase");
        return;
      }

      await createBootstrapProfile(response.data.session.user, username);
    }

    currentUser = response.data.user;
    currentProfile = await loadCurrentProfile();

    if (!currentProfile?.active) {
      await supabase.auth.signOut();
      showToast("Usuario desactivado");
      return;
    }

    showToast("Acceso correcto");
    goToNextPage();
  } catch (error) {
    showToast(getSupabaseErrorMessage(error));
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function createBootstrapProfile(user, username) {
  const { data: hasProfiles, error: countError } = await supabase.rpc("has_profiles");
  if (countError) throw countError;
  if (hasProfiles) {
    await supabase.auth.signOut();
    throw new Error("Ya existe un super usuario");
  }

  const { error } = await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: "Super usuario",
    role: "superadmin",
    active: true,
  });
  if (error) throw error;
}

async function loadCurrentProfile() {
  if (!currentUser) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, active, created_at")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    handleSupabaseError(error, "cargar perfil");
    return null;
  }

  return data;
}

function isSuperUser() {
  return currentProfile?.role === "superadmin";
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function emailForUsername(username) {
  return `${username}@${USER_EMAIL_DOMAIN}`;
}

function hydrateUserShell() {
  const username = currentProfile?.username || currentUser?.email?.split("@")[0] || "usuario";
  const adminCard = document.querySelector(".admin-card");
  const avatar = adminCard?.querySelector(".avatar");
  const name = adminCard?.querySelector("strong");
  const mail = adminCard?.querySelector("small");

  if (avatar) avatar.textContent = username.slice(0, 1).toUpperCase();
  if (name) name.textContent = currentProfile?.display_name || username;
  if (mail) mail.textContent = isSuperUser() ? "Super usuario" : `@${username}`;
  if (adminCard && !q("logoutButton")) {
    adminCard.insertAdjacentHTML(
      "beforeend",
      '<button class="logout-button" id="logoutButton" type="button">Salir</button>'
    );
  }
  document.body.dataset.superuser = String(isSuperUser());
  document.querySelectorAll(".superuser-only").forEach((item) => {
    item.hidden = !isSuperUser();
  });
  q("logoutButton")?.addEventListener("click", signOut);
}

async function signOut() {
  try {
    await flushRemoteSave();
  } catch (error) {
    handleSupabaseError(error, "guardar antes de salir");
  }
  await supabase?.auth.signOut();
  window.location.href = LOGIN_PATH;
}

function redirectToLogin() {
  if (page === "login") return;
  const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.href = `${LOGIN_PATH}?next=${next}`;
}

function goToNextPage() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next?.startsWith("/") ? next : "/index.html";
}

function scopedStorageKey(key) {
  return currentUser?.id ? `${key}:${currentUser.id}` : key;
}

function storageGet(key) {
  return localStorage.getItem(scopedStorageKey(key));
}

function storageSet(key, value) {
  localStorage.setItem(scopedStorageKey(key), value);
}

function storageRemove(key) {
  localStorage.removeItem(scopedStorageKey(key));
}

function bindShell() {
  q("menuToggle")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });
}

function bindNotifications() {
  const button = document.querySelector(".notification-button");
  if (!button) return;

  button.type = "button";
  button.title = "Activar notificaciones en este telefono";
  button.setAttribute("aria-label", "Activar notificaciones");
  updateNotificationButton(button);
  button.addEventListener("click", () => {
    enablePushNotifications(button).catch((error) => {
      console.warn("No se pudieron activar las notificaciones", error);
      showToast(getNotificationErrorMessage(error));
    });
  });
}

function updateNotificationButton(button = document.querySelector(".notification-button")) {
  if (!button) return;
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  button.classList.toggle("is-enabled", permission === "granted");
  const badge = button.querySelector("span");
  if (badge) badge.textContent = permission === "granted" ? "ON" : "!";
}

async function enablePushNotifications(button) {
  if (!currentUser) {
    showToast("Entra con tu usuario para activar notificaciones");
    return false;
  }

  if (!canUsePushNotifications()) {
    showToast("Este telefono no soporta notificaciones web");
    return false;
  }

  if (!hasFirebaseMessagingConfig()) {
    showToast("Falta configurar Firebase en Vercel");
    return false;
  }

  if (!FIREBASE_VAPID_KEY) {
    showToast("Falta la VAPID key de Firebase");
    return false;
  }

  if (button) button.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    updateNotificationButton(button);
    if (permission !== "granted") {
      showToast("Permiso de notificaciones no aceptado");
      return false;
    }

    const [messaging, serviceWorkerRegistration] = await Promise.all([
      getFirebaseMessagingInstance(),
      ensureServiceWorkerRegistration(),
    ]);
    if (!serviceWorkerRegistration) {
      showToast("No se pudo activar el servicio del telefono");
      return false;
    }

    const registeredId = await registerFirebaseMessaging(messaging, serviceWorkerRegistration);
    let legacyToken = "";
    try {
      legacyToken = await getToken(messaging, {
        vapidKey: FIREBASE_VAPID_KEY,
        serviceWorkerRegistration,
      });
    } catch (error) {
      console.warn("Firebase no entrego token heredado; se usara FID si esta disponible", error);
    }
    if (legacyToken) await saveNotificationRegistration(legacyToken, "token");

    if (!registeredId && !legacyToken) {
      showToast("No se pudo registrar este telefono");
      return false;
    }

    updateNotificationButton(button);
    showToast("Notificaciones activadas");
    return true;
  } finally {
    if (button) button.disabled = false;
  }
}

function canUsePushNotifications() {
  return Boolean(window.isSecureContext && "Notification" in window && "serviceWorker" in navigator);
}

function hasFirebaseMessagingConfig() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.projectId &&
      FIREBASE_CONFIG.messagingSenderId &&
      FIREBASE_CONFIG.appId
  );
}

async function getFirebaseMessagingInstance() {
  if (firebaseMessaging) return firebaseMessaging;
  if (firebaseSupported === null) firebaseSupported = await isSupported();
  if (!firebaseSupported) throw new Error("messaging-not-supported");

  firebaseApp = firebaseApp || initializeApp(FIREBASE_CONFIG);
  firebaseMessaging = getMessaging(firebaseApp);
  if (!foregroundMessageUnsubscribe) {
    foregroundMessageUnsubscribe = onMessage(firebaseMessaging, (payload) => {
      const title = payload?.notification?.title || payload?.data?.title || "Nueva notificacion";
      showToast(title);
    });
  }
  return firebaseMessaging;
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return navigator.serviceWorker.register("/service-worker.js");
}

async function registerFirebaseMessaging(messaging, serviceWorkerRegistration) {
  let resolved = false;
  const registeredIdPromise = new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      if (!resolved) resolve("");
    }, 2500);

    messagingRegisteredUnsubscribe?.();
    messagingRegisteredUnsubscribe = onRegistered(messaging, async (registrationId) => {
      resolved = true;
      window.clearTimeout(timeout);
      try {
        await saveNotificationRegistration(registrationId, "fid");
      } catch (error) {
        console.warn("No se pudo guardar el FID de Firebase", error);
      }
      resolve(registrationId);
    });
  });

  await registerMessaging(messaging, {
    vapidKey: FIREBASE_VAPID_KEY,
    serviceWorkerRegistration,
  });

  return registeredIdPromise;
}

async function saveNotificationRegistration(registrationId, registrationType) {
  if (!supabase || !currentUser || !registrationId) return false;
  const now = new Date().toISOString();
  const { error } = await supabase.from("notification_tokens").upsert(
    {
      user_id: currentUser.id,
      registration_id: registrationId,
      registration_type: registrationType,
      device_label: getDeviceLabel(),
      user_agent: navigator.userAgent || "",
      updated_at: now,
      last_seen_at: now,
    },
    { onConflict: "user_id,registration_id" }
  );
  if (error) throw error;
  return true;
}

function getDeviceLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Telefono";
  const standalone = isStandaloneApp() ? "app" : "navegador";
  return `${platform} - ${standalone}`;
}

function getNotificationErrorMessage(error) {
  if (isMissingNotificationsSetup(error)) return "Falta actualizar notificaciones: ejecuta supabase/schema.sql";
  if (getErrorText(error).includes("messaging-not-supported")) return "Este telefono no soporta Firebase";
  if (error?.message) return error.message;
  return "No se pudieron activar notificaciones";
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;
    const loan = createLoanFromForm();
    state.loans.unshift(loan);
    selectedLoanId = loan.id;
    storageSet(SELECTED_LOAN_KEY, selectedLoanId);
    try {
      await saveState({ immediate: true });
      showToast("Prestamo guardado");
    } catch (error) {
      handleSupabaseError(error, "guardar datos");
    } finally {
      window.location.href = "/prestamos.html";
    }
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
    storageSet(SELECTED_INSTALLMENT_KEY, button.dataset.installmentId);
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = event.submitter;
    const loan = state.loans.find((item) => item.id === q("paymentLoanSelect").value);
    const installmentId = q("paymentInstallmentSelect").value;
    const amount = numberFrom(q("paymentAmount").value);
    if (!loan || !installmentId || amount <= 0) {
      showToast("No hay cuota pendiente para registrar");
      return;
    }

    if (submitButton) submitButton.disabled = true;
    try {
      const payment = applyPayment(loan, installmentId, amount, {
        date: q("paymentDate").value || todayIso,
        method: q("paymentMethod").value,
        note: q("paymentNote").value.trim(),
      });

      selectLoan(loan.id);
      storageRemove(SELECTED_INSTALLMENT_KEY);
      await saveState({ immediate: true });
      renderAll();
      queuePaymentNotification(loan, payment).catch((error) => {
        console.warn("No se pudo enviar la notificacion del pago", error);
      });
      showToast(`Pago registrado por ${formatMoney(payment.amount)}`);
    } catch (error) {
      handleSupabaseError(error, "guardar pago");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

async function queuePaymentNotification(loan, payment) {
  if (!supabase || !currentUser || !loan || !payment) return false;
  const summary = getLoanSummary(loan);
  const title = "Pago registrado";
  const body = `${loan.borrower}: abono de ${formatMoney(payment.amount)}. Saldo ${formatMoney(summary.remaining)}.`;
  const payload = {
    type: "payment_registered",
    loanId: loan.id,
    paymentId: payment.id,
    borrower: loan.borrower,
    phone: loan.phone || "",
    amount: String(payment.amount),
    balance: String(summary.remaining),
    date: payment.date,
    url: "/pagos.html",
  };

  const { data, error } = await supabase
    .from("notification_events")
    .insert({
      user_id: currentUser.id,
      loan_id: loan.id,
      payment_id: payment.id,
      borrower: loan.borrower,
      borrower_phone: loan.phone || null,
      title,
      body,
      payload,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingNotificationsSetup(error)) return false;
    throw error;
  }

  if (data?.id) {
    triggerPaymentNotificationSend(data.id).catch((sendError) => {
      console.warn("La notificacion quedo pendiente de envio", sendError);
    });
  }
  return true;
}

async function triggerPaymentNotificationSend(eventId) {
  if (!eventId || !supabase) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) return false;

  const response = await fetch("/api/send-payment-notification", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ eventId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "No se pudo enviar la notificacion");
  }
  return true;
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

function bindUsersAdmin() {
  const form = q("userForm");
  if (form) {
    form.addEventListener("submit", handleUserSubmit);
  }

  q("usersBody")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    if (button.dataset.action === "toggle-user") {
      await toggleUserStatus(button.dataset.userId, button.dataset.active !== "true");
    }
  });
}

async function handleUserSubmit(event) {
  event.preventDefault();
  if (!isSuperUser()) {
    showToast("Solo el super usuario puede crear usuarios");
    return;
  }

  const username = normalizeUsername(q("newUsername").value);
  const password = q("newPassword").value;
  const role = q("newRole").value;
  const displayName = q("newDisplayName").value.trim() || username;

  if (!username || password.length < 6) {
    showToast("Usuario y clave minima de 6 caracteres");
    return;
  }

  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    const { data, error } = await userAdminClient.auth.signUp({
      email: emailForUsername(username),
      password,
    });
    if (error) throw error;
    if (!data.user?.id) throw new Error("No se pudo crear el usuario");

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      username,
      display_name: displayName,
      role,
      active: true,
    });
    if (profileError) throw profileError;

    event.currentTarget.reset();
    await loadUsersAdmin();
    showToast("Usuario creado");
  } catch (error) {
    showToast(getSupabaseErrorMessage(error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleUserStatus(userId, active) {
  if (!isSuperUser()) return;
  if (userId === currentUser?.id && !active) {
    showToast("No puedes desactivar tu propio usuario");
    return;
  }

  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) {
    handleSupabaseError(error, "actualizar usuario");
    return;
  }

  await loadUsersAdmin();
  showToast(active ? "Usuario activado" : "Usuario desactivado");
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
  renderUsersAdmin();
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
      if (isOpenOnTrackStatus(status.key)) acc.active += 1;
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
    const matchesFilter = matchesStatusFilter(status.key, activeFilter);
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
        <td>${loan.interestRate}% ${getInterestTypeLabel(loan.interestType)}</td>
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
      if (isOpenOnTrackStatus(status)) acc.active += 1;
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
    <div><span>Tipo interes</span><strong>${getInterestTypeLabel(loan.interestType)}</strong></div>
    <div><span>Tasa</span><strong>${loan.interestRate}%</strong></div>
    <div><span>Interes mensual</span><strong>${formatMoney(summary.monthlyInterest)}</strong></div>
    <div><span>Interes total</span><strong>${formatMoney(summary.interest)}</strong></div>
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
        : { label: "Pendiente", className: "status-pending" };

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

  const preferredInstallmentId = storageGet(SELECTED_INSTALLMENT_KEY);
  const installment = pendingInstallments.find((item) => item.id === preferredInstallmentId) || pendingInstallments[0];
  if (installment) {
    q("paymentInstallmentSelect").value = installment.id;
    q("paymentAmount").value = installment.amount - installment.paid;
    q("paymentAmount").max = getLoanSummary(selectedLoan).remaining;
  }
  q("paymentDate").value = todayIso;
}

async function loadUsersAdmin() {
  if (page !== "users" || !isSuperUser()) return;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, active, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    handleSupabaseError(error, "cargar usuarios");
    return;
  }

  adminUsers = data || [];
  renderUsersAdmin();
}

function renderUsersAdmin() {
  const body = q("usersBody");
  if (!body) return;

  if (!isSuperUser()) {
    body.innerHTML = `<tr><td class="empty-state" colspan="5">Solo el super usuario puede administrar usuarios.</td></tr>`;
    return;
  }

  if (!adminUsers.length) {
    body.innerHTML = `<tr><td class="empty-state" colspan="5">No hay usuarios registrados.</td></tr>`;
    return;
  }

  body.innerHTML = adminUsers
    .map((user) => {
      const active = Boolean(user.active);
      const isSelf = user.id === currentUser?.id;
      const status = active
        ? '<span class="status-pill status-active">Activo</span>'
        : '<span class="status-pill status-overdue">Inactivo</span>';
      const role = user.role === "superadmin" ? "Super usuario" : "Usuario";
      const actionLabel = active ? "Desactivar" : "Activar";
      return `
        <tr>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.display_name || user.username)}</td>
          <td>${role}</td>
          <td>${status}</td>
          <td><button class="ghost-button small-button" type="button" data-action="toggle-user" data-user-id="${user.id}" data-active="${active}" ${isSelf ? "disabled" : ""}>${actionLabel}</button></td>
        </tr>
      `;
    })
    .join("");
}

function updatePreview() {
  if (!q("previewInterest")) return;
  const amount = numberFrom(q("amount").value);
  const rate = numberFrom(q("interestRate").value);
  const termDays = clampTermDays(q("termDays").value);
  const interestType = normalizeInterestType(q("interestType")?.value);
  const count = Math.max(1, Number(q("installmentsCount").value || 1));
  const totals = calculateTotals(amount, rate, count, termDays, interestType);
  if (q("previewBaseInterestLabel")) {
    q("previewBaseInterestLabel").textContent = interestType === "mensual" ? "Interes mensual" : "Interes unico";
  }
  if (q("previewMonthlyInterest")) q("previewMonthlyInterest").textContent = formatMoney(totals.monthlyInterest);
  q("previewInterest").textContent = formatMoney(totals.interest);
  q("previewTotal").textContent = formatMoney(totals.total);
  q("previewCount").textContent = count;
  q("previewInstallment").textContent = formatMoney(totals.installment);
}

function loadState() {
  const saved = storageGet(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.loans)) return sanitizeState(parsed);
    } catch (error) {
      console.warn("No se pudo leer el respaldo local", error);
    }
  }

  const oldSaved = storageGet(OLD_STORAGE_KEY);
  if (oldSaved) {
    try {
      const parsed = JSON.parse(oldSaved);
      if (Array.isArray(parsed.loans) && parsed.loans.length > 1) {
        return sanitizeState({ loans: parsed.loans.map(normalizeLoan) }, { removeLegacyDemos: true });
      }
    } catch (error) {
      console.warn("No se pudo migrar el respaldo anterior", error);
    }
  }

  return { loans: [] };
}

function saveState(options = {}) {
  storageSet(STORAGE_KEY, JSON.stringify(state));
  markPendingSync();
  if (options.immediate) return flushRemoteSave();
  queueRemoteSave();
  return Promise.resolve(false);
}

async function loadRemoteState() {
  if (!supabase) return;
  try {
    if (hasPendingSync()) {
      await flushRemoteSave();
    }

    const { data: loans, error: loansError } = await supabase
      .from("loans")
      .select("*")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (loansError) throw loansError;

    if (!loans?.length) {
      if (state.loans.length) {
        await flushRemoteSave();
        showToast("Datos locales sincronizados");
      }
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

    state = sanitizeState(
      { loans: loans.map((loan) => fromDbLoan(loan, installments || [], payments || [])) },
      { removeLegacyDemos: true }
    );
    selectedLoanId = state.loans[0]?.id || "";
    storageSet(SELECTED_LOAN_KEY, selectedLoanId);
    storageSet(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  } catch (error) {
    handleSupabaseError(error, "cargar datos");
  }
}

function queueRemoteSave() {
  if (!supabase || !supabaseSchemaReady) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    flushRemoteSave().catch((error) => handleSupabaseError(error, "guardar datos"));
  }, 400);
}

async function flushRemoteSave() {
  if (!supabase || !supabaseSchemaReady) return false;
  window.clearTimeout(syncTimer);
  await syncAllToSupabase();
  return true;
}

async function syncAllToSupabase() {
  if (!supabase) return;
  const pendingDeletedLoanIds = getPendingDeletedLoanIds();

  if (!state.loans.length) {
    if (pendingDeletedLoanIds.length) {
      const { error } = await supabase.from("loans").delete().in("id", pendingDeletedLoanIds);
      if (error) throw error;
    }
    clearPendingDeletedLoanIds(pendingDeletedLoanIds);
    clearPendingSync();
    return;
  }

  const dbLoans = state.loans.map(toDbLoan);
  const loanIds = dbLoans.map((loan) => loan.id);
  const dbInstallments = state.loans.flatMap((loan) => loan.installments.map((item) => toDbInstallment(item, loan.id)));
  const dbPayments = state.loans.flatMap((loan) => loan.payments.map((item) => toDbPayment(item, loan.id)));
  const deletedLoanIds = pendingDeletedLoanIds.filter((loanId) => !loanIds.includes(loanId));

  if (deletedLoanIds.length) {
    const { error } = await supabase.from("loans").delete().in("id", deletedLoanIds);
    if (error) throw error;
  }

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

  clearPendingDeletedLoanIds(deletedLoanIds);
  clearPendingSync();
}

async function deleteRemoteLoans(loanIds) {
  if (!loanIds.length) return;
  markPendingDeletedLoans(loanIds);
  if (!supabase) return;
  const { error } = await supabase.from("loans").delete().in("id", loanIds);
  if (error) handleSupabaseError(error, "eliminar datos");
  else clearPendingDeletedLoanIds(loanIds);
}

function markPendingSync() {
  if (!supabase || !supabaseSchemaReady) return;
  storageSet(PENDING_SYNC_KEY, "1");
}

function clearPendingSync() {
  storageRemove(PENDING_SYNC_KEY);
}

function hasPendingSync() {
  return storageGet(PENDING_SYNC_KEY) === "1";
}

function getPendingDeletedLoanIds() {
  try {
    const ids = JSON.parse(storageGet(DELETED_LOANS_KEY) || "[]");
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch (error) {
    console.warn("No se pudo leer la lista de prestamos eliminados", error);
    return [];
  }
}

function markPendingDeletedLoans(loanIds) {
  const ids = new Set([...getPendingDeletedLoanIds(), ...loanIds.filter(Boolean)]);
  storageSet(DELETED_LOANS_KEY, JSON.stringify([...ids]));
  markPendingSync();
}

function clearPendingDeletedLoanIds(loanIds) {
  if (!loanIds.length) return;
  const done = new Set(loanIds);
  const pending = getPendingDeletedLoanIds().filter((loanId) => !done.has(loanId));
  if (pending.length) storageSet(DELETED_LOANS_KEY, JSON.stringify(pending));
  else storageRemove(DELETED_LOANS_KEY);
}

function createLoanFromForm() {
  const amount = numberFrom(q("amount").value);
  const interestRate = numberFrom(q("interestRate").value);
  const interestType = normalizeInterestType(q("interestType")?.value);
  const termDays = clampTermDays(q("termDays").value);
  const installmentsCount = Math.max(1, Number(q("installmentsCount").value));
  const startDate = q("startDate").value || todayIso;
  const totals = calculateTotals(amount, interestRate, installmentsCount, termDays, interestType);
  return {
    id: uid(),
    borrower: q("borrower").value.trim(),
    phone: q("phone").value.trim(),
    amount,
    interestRate,
    interestType,
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

function calculateTotals(amount, interestRate, installmentsCount, termDays = 30, interestType = "unico") {
  const monthlyInterest = Math.round(amount * (interestRate / 100));
  const termMonths = getTermMonths(termDays);
  const interest = normalizeInterestType(interestType) === "mensual"
    ? Math.round(monthlyInterest * termMonths)
    : monthlyInterest;
  const total = amount + interest;
  const installment = Math.ceil(total / Math.max(1, installmentsCount));
  return { monthlyInterest, interest, total, installment, termMonths };
}

function buildSchedule(total, count, startDate, termDays) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: uid(),
      number,
      dueDate: addDays(startDate, Math.max(1, Math.round((termDays / count) * number))),
      amount: number === count ? total - base * (count - 1) : base,
      paid: 0,
      paidDate: "",
    };
  });
}

function normalizeLoan(loan) {
  return {
    ...loan,
    interestType: normalizeInterestType(loan.interestType || loan.interest_type),
    termDays: clampTermDays(loan.termDays || loan.term_days || 30),
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

function sanitizeState(value, options = {}) {
  const loans = Array.isArray(value.loans)
    ? value.loans.filter((loan) => !isLegacyDemoLoan(loan, options))
    : [];
  return { ...value, loans };
}

function isLegacyDemoLoan(loan, options = {}) {
  return options.removeLegacyDemos && isDemoLoan(loan) && isBeforeLegacyDemoCutoff(loan.createdAt);
}

function isDemoLoan(loan) {
  return DEMO_LOANS.some(([borrower, phone, amount]) => {
    return loan.borrower === borrower && loan.phone === phone && Number(loan.amount) === amount;
  });
}

function isBeforeLegacyDemoCutoff(value) {
  if (!value) return true;
  const time = new Date(value).getTime();
  const cutoff = new Date(LEGACY_DEMO_CUTOFF).getTime();
  return !Number.isFinite(time) || time < cutoff;
}

function openEditDialog(loan) {
  q("editLoanId").value = loan.id;
  q("editBorrower").value = loan.borrower;
  q("editPhone").value = loan.phone || "";
  q("editAmount").value = loan.amount;
  q("editInterestRate").value = loan.interestRate;
  q("editInterestType").value = normalizeInterestType(loan.interestType);
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
  const interestType = normalizeInterestType(q("editInterestType").value);
  const termDays = clampTermDays(q("editTermDays").value);
  const installmentsCount = Math.max(1, Number(q("editInstallmentsCount").value));
  const startDate = q("editStartDate").value || todayIso;
  const totals = calculateTotals(amount, interestRate, installmentsCount, termDays, interestType);

  loan.borrower = q("editBorrower").value.trim();
  loan.phone = q("editPhone").value.trim();
  loan.amount = amount;
  loan.interestRate = interestRate;
  loan.interestType = interestType;
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

  const payment = {
    id: uid(),
    amount: appliedTotal,
    date: details.date,
    method: details.method,
    note: details.note,
  };
  loan.payments.push(payment);
  return payment;
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
  const totals = calculateTotals(
    Number(loan.amount || 0),
    Number(loan.interestRate || 0),
    Math.max(1, Number(loan.installmentsCount || loan.installments?.length || 1)),
    clampTermDays(loan.termDays || 30),
    normalizeInterestType(loan.interestType)
  );
  const paid = loan.installments.reduce((sum, item) => sum + Number(item.paid || 0), 0);
  return {
    monthlyInterest: totals.monthlyInterest,
    termMonths: totals.termMonths,
    interest: totals.interest,
    total: totals.total,
    paid,
    remaining: Math.max(0, totals.total - paid),
  };
}

function getLoanStatus(loan) {
  const summary = getLoanSummary(loan);
  if (summary.remaining <= 0) return { key: "closed", label: "Pagado", className: "status-closed" };
  const installments = Array.isArray(loan.installments) ? loan.installments : [];
  const hasOverdue = installments.some((item) => item.amount > item.paid && item.dueDate < todayIso);
  if (hasOverdue) return { key: "overdue", label: "En mora", className: "status-overdue" };
  if (summary.paid > 0) return { key: "active", label: "Abonado", className: "status-active" };
  return { key: "pending", label: "Pendiente", className: "status-pending" };
}

function isOpenOnTrackStatus(statusKey) {
  return statusKey === "active" || statusKey === "pending";
}

function matchesStatusFilter(statusKey, filter) {
  if (filter === "all") return true;
  if (filter === "active") return isOpenOnTrackStatus(statusKey);
  return statusKey === filter;
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
      paid: 0,
      pending: 0,
      hasOverdue: false,
    };
    current.loanCount += 1;
    current.totalAmount += loan.amount;
    current.paid += summary.paid;
    current.pending += summary.remaining;
    current.hasOverdue = current.hasOverdue || getLoanStatus(loan).key === "overdue";
    clients.set(key, current);
  });

  return Array.from(clients.values()).map((client) => {
    const status = client.hasOverdue
      ? { label: "En mora", className: "status-overdue" }
      : client.pending <= 0
        ? { label: "Pagado", className: "status-closed" }
        : client.paid > 0
          ? { label: "Abonado", className: "status-active" }
          : { label: "Pendiente", className: "status-pending" };
    return { ...client, status };
  });
}

function getClientKey(loan) {
  return `${loan.borrower}-${loan.phone}`.trim().toLowerCase();
}

function selectLoan(loanId) {
  selectedLoanId = loanId;
  if (loanId) storageSet(SELECTED_LOAN_KEY, loanId);
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
      getInterestTypeLabel(loan.interestType),
      `${loan.interestRate}%`,
      summary.monthlyInterest,
      summary.interest,
      summary.total,
      summary.paid,
      summary.remaining,
      loan.termDays,
      loan.paymentFrequency,
      getLoanStatus(loan).label,
    ];
  });

  const header = [
    "Cliente",
    "Celular",
    "Monto",
    "Tipo interes",
    "Tasa",
    "Interes mensual",
    "Interes total",
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
  const filters = { "Solo activos": "active", "Solo en mora": "overdue", "Solo pagados": "closed" };
  const status = filters[type];
  if (!status) return state.loans;
  return state.loans.filter((loan) => getLoanStatus(loan).key === status);
}

function toDbLoan(loan) {
  return {
    id: loan.id,
    user_id: currentUser?.id,
    borrower: loan.borrower,
    phone: loan.phone,
    amount: loan.amount,
    interest_rate: loan.interestRate,
    interest_type: normalizeInterestType(loan.interestType),
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
    interestType: normalizeInterestType(loan.interest_type),
    termDays: clampTermDays(loan.term_days || 30),
    installmentsCount: Number(loan.installments_count || 1),
    startDate: loan.start_date,
    paymentFrequency: loan.payment_frequency || "Quincenal",
    notes: loan.notes || "",
    userId: loan.user_id || "",
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
  if (
    isMissingSupabaseTable(error) ||
    isMissingUserColumn(error) ||
    isMissingLoanSchemaSetup(error) ||
    isMissingProfilesSetup(error) ||
    isMissingNotificationsSetup(error)
  ) {
    supabaseSchemaReady = false;
  }
  console.warn(`Supabase: no se pudo ${action}. ${message}`, error);
  showToast(message);
}

function getSupabaseErrorMessage(error) {
  if (isMissingNotificationsSetup(error)) return "Falta actualizar notificaciones: ejecuta supabase/schema.sql";
  if (isMissingSupabaseTable(error)) return "Faltan tablas en Supabase: ejecuta supabase/schema.sql";
  if (isMissingLoanSchemaSetup(error)) return "Falta actualizar prestamos: ejecuta supabase/schema.sql";
  if (isMissingUserColumn(error)) return "Falta actualizar Supabase: ejecuta supabase/schema.sql";
  if (isMissingProfilesSetup(error)) return "Falta actualizar usuarios: ejecuta supabase/schema.sql";
  if (isInvalidLogin(error)) return "Usuario o clave incorrectos. Si es primera vez, toca Crear super usuario.";
  if (isEmailRateLimit(error)) return "Supabase bloqueo intentos por unos minutos. Desactiva confirmacion de email y espera antes de intentar.";
  if (isEmailConfirmationRequired(error)) return "Desactiva confirmacion de email en Supabase y vuelve a crear el usuario.";
  if (isUserAlreadyRegistered(error)) return "Ese usuario ya existe. Entra con su clave o crea otro usuario.";
  if (error?.message) return `Supabase: ${error.message}`;
  return "Supabase no respondio; usando respaldo local";
}

function isMissingSupabaseTable(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return error?.status === 404 || text.includes("PGRST205") || text.includes("schema cache");
}

function isMissingUserColumn(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return text.includes("user_id") && (text.includes("column") || text.includes("schema cache"));
}

function isMissingLoanSchemaSetup(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return text.includes("interest_type") || text.includes("loans_interest_type_check");
}

function isMissingProfilesSetup(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return text.includes("profiles") || text.includes("has_profiles");
}

function isMissingNotificationsSetup(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return text.includes("notification_tokens") || text.includes("notification_events");
}

function isInvalidLogin(error) {
  return getErrorText(error).includes("invalid login credentials");
}

function isEmailRateLimit(error) {
  const text = getErrorText(error);
  return text.includes("email rate limit") || text.includes("rate limit exceeded");
}

function isEmailConfirmationRequired(error) {
  const text = getErrorText(error);
  return text.includes("email not confirmed") || text.includes("confirm");
}

function isUserAlreadyRegistered(error) {
  const text = getErrorText(error);
  return text.includes("user already registered") || text.includes("already exists") || text.includes("ya existe");
}

function getErrorText(error) {
  return `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
}

function numberFrom(value) {
  return Number(value || 0);
}

function clampTermDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return 30;
  return Math.min(120, Math.max(1, Math.round(days)));
}

function getTermMonths(termDays) {
  return clampTermDays(termDays) / 30;
}

function normalizeInterestType(value) {
  return value === "mensual" ? "mensual" : "unico";
}

function getInterestTypeLabel(value) {
  return normalizeInterestType(value) === "mensual" ? "Mensual" : "Unico";
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
