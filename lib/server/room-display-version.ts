export function roomDisplayVersion() {
  return process.env.VERCEL_DEPLOYMENT_ID || null;
}
