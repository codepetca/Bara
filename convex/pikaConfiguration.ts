export function isPikaAttendanceIntegrationEnabled() {
  return process.env.PIKA_ATTENDANCE_INTEGRATION === "true";
}

export const PIKA_PRODUCTION_ORIGIN = "https://pika.codepet.ca";

export function isAllowedPikaDeliveryOrigin(url: URL) {
  return url.origin === PIKA_PRODUCTION_ORIGIN ||
    (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
}
