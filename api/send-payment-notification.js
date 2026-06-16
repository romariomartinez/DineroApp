import { createClient } from "@supabase/supabase-js";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

let supabaseAdmin = null;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo no permitido" });

  if (!hasServerConfig()) {
    return res.status(503).json({ error: "Faltan variables privadas de Supabase o Firebase" });
  }

  try {
    ensureFirebaseAdmin();
    const supabase = getSupabaseAdmin();
    const accessToken = getBearerToken(req.headers.authorization || "");
    if (!accessToken) return res.status(401).json({ error: "Sesion requerida" });

    const { data: userData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !userData.user) return res.status(401).json({ error: "Sesion invalida" });

    const body = parseBody(req.body);
    const eventId = body.eventId;
    if (!eventId) return res.status(400).json({ error: "Falta eventId" });

    const { data: event, error: eventError } = await supabase
      .from("notification_events")
      .select("*")
      .eq("id", eventId)
      .eq("user_id", userData.user.id)
      .single();

    if (eventError || !event) return res.status(404).json({ error: "Notificacion no encontrada" });
    if (event.status === "sent") return res.status(200).json({ sent: 0, status: "sent" });

    await markEvent(supabase, event.id, { status: "processing", error_message: null });

    const { data: registrations, error: tokensError } = await supabase
      .from("notification_tokens")
      .select("id, registration_id")
      .eq("user_id", event.user_id)
      .eq("registration_type", "token");

    if (tokensError) throw tokensError;

    const tokens = [...new Set((registrations || []).map((item) => item.registration_id).filter(Boolean))];
    if (!tokens.length) {
      await markEvent(supabase, event.id, {
        status: "failed",
        error_message: "No hay telefonos registrados para este usuario",
      });
      return res.status(200).json({ sent: 0, status: "failed" });
    }

    const payload = normalizePayload(event.payload);
    const link = buildNotificationLink(payload.url || "/pagos.html");
    const message = {
      tokens,
      notification: {
        title: event.title,
        body: event.body,
      },
      data: toStringData({
        ...payload,
        eventId: event.id,
        loanId: event.loan_id,
        paymentId: event.payment_id,
      }),
      webpush: {
        notification: {
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        },
        ...(link ? { fcmOptions: { link } } : {}),
      },
    };

    const response = await getMessaging().sendEachForMulticast(message);
    await deleteInvalidTokens(supabase, registrations || [], response.responses);

    const status = response.successCount > 0 ? "sent" : "failed";
    await markEvent(supabase, event.id, {
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_message: status === "sent" ? null : "Firebase no entrego la notificacion",
    });

    return res.status(200).json({
      sent: response.successCount,
      failed: response.failureCount,
      status,
    });
  } catch (error) {
    console.error("Error enviando notificacion", error);
    return res.status(500).json({ error: error.message || "No se pudo enviar la notificacion" });
  }
}

function hasServerConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY);
}

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

function ensureFirebaseAdmin() {
  if (getApps().length) return;
  initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
    }),
  });
}

function getBearerToken(value) {
  const [type, token] = value.split(" ");
  return type?.toLowerCase() === "bearer" ? token : "";
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload;
}

function toStringData(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? "")]));
}

function buildNotificationLink(path) {
  const baseUrl = process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!baseUrl) return "";
  try {
    return new URL(path, baseUrl).href;
  } catch (error) {
    return baseUrl;
  }
}

async function markEvent(supabase, eventId, values) {
  const { error } = await supabase.from("notification_events").update(values).eq("id", eventId);
  if (error) throw error;
}

async function deleteInvalidTokens(supabase, registrations, responses) {
  const invalidCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]);
  const invalidIds = responses
    .map((response, index) => (invalidCodes.has(response.error?.code) ? registrations[index]?.id : null))
    .filter(Boolean);

  if (!invalidIds.length) return;
  const { error } = await supabase.from("notification_tokens").delete().in("id", invalidIds);
  if (error) throw error;
}
