export const displayPairingAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const displayPairingCodePattern = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const displayCredentialPattern = /^[A-Za-z0-9]{40}$/;
export const displayPairingLifetime = 5 * 60_000;
export const displayPairingBeginPath = "/api/display/pairing";
export const displayPairingHashPattern = /^[a-f0-9]{64}$/;
export const displayPairingNetworkLimit = 20;
export const displayHeartbeatInterval = 15 * 60_000;

export function normalizeDisplayPairingCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}
