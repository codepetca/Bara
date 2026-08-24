const DELIVERY_ENABLED_VALUE = "true";

export const WORKOS_MAGIC_AUTH_WEBHOOK_PATH = "/api/webhooks/workos";

export function isWorkosMagicAuthBrevoDeliveryEnabled() {
  return (
    process.env.WORKOS_MAGIC_AUTH_BREVO_DELIVERY?.trim().toLowerCase() ===
    DELIVERY_ENABLED_VALUE
  );
}

export function workosWebhookSecret() {
  const secret = process.env.WORKOS_MAGIC_AUTH_WEBHOOK_SECRET ?? "";
  if (!secret) {
    throw new Error("WorkOS Magic Auth webhook is not configured.");
  }
  return secret;
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);
}

export function workosMagicEmailDeliveryConfiguration() {
  if (!isWorkosMagicAuthBrevoDeliveryEnabled()) return null;

  const workosApiKey = process.env.WORKOS_API_KEY ?? "";
  const baraClientId = process.env.WORKOS_CLIENT_ID?.trim() ?? "";
  const pikaClientId = process.env.PIKA_WORKOS_CLIENT_ID?.trim() ?? "";
  const brevoApiKey = process.env.BREVO_API_KEY ?? "";
  const brevoTemplateId = Number(process.env.BREVO_TEMPLATE_ID);
  const brevoFromEmail = process.env.BREVO_FROM_EMAIL?.trim() ?? "";
  const brevoFromName = process.env.BREVO_FROM_NAME?.trim() ?? "";

  if (
    workosApiKey.length < 8 ||
    !baraClientId.startsWith("client_") ||
    !pikaClientId.startsWith("client_") ||
    baraClientId === pikaClientId ||
    brevoApiKey.length < 8 ||
    !Number.isSafeInteger(brevoTemplateId) ||
    brevoTemplateId <= 0 ||
    !validEmail(brevoFromEmail) ||
    !brevoFromName ||
    brevoFromName.length > 100
  ) {
    throw new Error("WorkOS Magic Auth Brevo delivery is not configured.");
  }

  return {
    workosApiKey,
    baraClientId,
    pikaClientId,
    brevoApiKey,
    brevoTemplateId,
    brevoFromEmail,
    brevoFromName,
  };
}
