export function isPikaAttendanceIntegrationEnabled() {
  return process.env.PIKA_ATTENDANCE_INTEGRATION === "true";
}

export const PIKA_PRODUCTION_ORIGIN = "https://pika.codepet.ca";

function isHttpLoopback(url: URL) {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

export function configuredPikaRoomCheckInOrigin(configured: string) {
  const pilotSite = process.env.PIKA_PILOT_CONVEX_SITE_URL?.trim();
  try {
    const url = new URL(configured);
    if (pilotSite && (pilotSite !== process.env.CONVEX_SITE_URL || url.protocol !== "https:" ||
      url.origin === PIKA_PRODUCTION_ORIGIN)) return null;
    if ((url.protocol === "https:" || isHttpLoopback(url)) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch { /* A malformed origin is unavailable. */ }
  return null;
}

export function isAllowedPikaDeliveryOrigin(url: URL) {
  if (process.env.PIKA_PILOT_CONVEX_SITE_URL?.trim()) {
    const pilotOrigin = configuredPikaRoomCheckInOrigin(process.env.PIKA_ROOM_CHECK_IN_ORIGIN?.trim() ?? "");
    return url.origin === pilotOrigin;
  }
  return url.origin === PIKA_PRODUCTION_ORIGIN || isHttpLoopback(url);
}
