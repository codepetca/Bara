export const SIGN_IN_URL = "/sign-in";
export const SIGN_UP_URL = "/sign-up";
export const AUTH_CALLBACK_URL = "/callback";

export const AUTH_ROUTE_PATHS = new Set([SIGN_IN_URL, SIGN_UP_URL, AUTH_CALLBACK_URL]);

export function getAuthCallbackUrl(requestUrl: string | URL) {
  const url = new URL(requestUrl.toString());
  url.pathname = AUTH_CALLBACK_URL;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getSafeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  return value;
}
