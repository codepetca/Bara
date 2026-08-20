export function isPikaAttendanceIntegrationEnabled() {
  return process.env.PIKA_ATTENDANCE_INTEGRATION === "true";
}
