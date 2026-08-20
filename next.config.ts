import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

export function getAllowedDevOrigins() {
  const envOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const interfaceOrigins = Object.values(networkInterfaces()).flatMap((interfaces) =>
    (interfaces ?? [])
      .filter((iface): iface is NonNullable<typeof iface> => Boolean(iface))
      .filter((iface) => iface.family === "IPv4" && !iface.internal)
      .map((iface) => iface.address),
  );

  return Array.from(new Set(["127.0.0.1", ...envOrigins, ...interfaceOrigins]));
}

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.NODE_ENV === "development" ? getAllowedDevOrigins() : undefined,
};

export default nextConfig;
