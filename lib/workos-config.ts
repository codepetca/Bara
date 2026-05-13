export const WORKOS_SETUP_URL = "/setup/workos";

type WorkosEnvVar = {
  name: string;
  description: string;
  isMissing: boolean;
};

export function getWorkosEnvStatus() {
  const values = {
    WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
    WORKOS_API_KEY: process.env.WORKOS_API_KEY,
    WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  };

  const variables: WorkosEnvVar[] = [
    {
      name: "WORKOS_CLIENT_ID",
      description: "WorkOS AuthKit client id for this environment.",
      isMissing: !values.WORKOS_CLIENT_ID,
    },
    {
      name: "WORKOS_API_KEY",
      description: "WorkOS secret API key used by the server-side AuthKit callback.",
      isMissing: !values.WORKOS_API_KEY,
    },
    {
      name: "WORKOS_COOKIE_PASSWORD",
      description: "At least 32 characters; encrypts AuthKit session cookies.",
      isMissing: !values.WORKOS_COOKIE_PASSWORD || values.WORKOS_COOKIE_PASSWORD.length < 32,
    },
    {
      name: "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
      description: "Callback URL registered in the WorkOS dashboard.",
      isMissing: !values.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
    },
  ];

  const missing = variables.filter((variable) => variable.isMissing);

  return {
    isReady: missing.length === 0,
    variables,
    missing,
  };
}
