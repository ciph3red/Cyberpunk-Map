import type { WiFiNetwork } from "@workspace/api-client-react";
import {
  loadUserApiSettings,
  resolveDatabaseApiBaseUrl,
} from "@/lib/user-api-settings";

interface SaveCsvImportResponse {
  success: boolean;
  importId: string;
  fileName: string;
  networkCount: number;
  createdAt: string;
}

function resolveCsvImportsUrl(): string {
  const settings = loadUserApiSettings();
  const fallback =
    typeof import.meta.env.VITE_API_BASE_URL === "string"
      ? import.meta.env.VITE_API_BASE_URL
      : null;

  const baseUrl = resolveDatabaseApiBaseUrl(settings, fallback);
  return `${baseUrl}/api/csv/imports`;
}

function buildErrorMessage(status: number, fallbackMessage: string, body: unknown): string {
  if (!body || typeof body !== "object") return `[${status}] ${fallbackMessage}`;

  const candidate = (body as Record<string, unknown>).error;
  if (typeof candidate === "string" && candidate.trim()) {
    return `[${status}] ${candidate}`;
  }

  return `[${status}] ${fallbackMessage}`;
}

export async function saveCsvImportToServer(
  fileName: string,
  networks: WiFiNetwork[],
): Promise<SaveCsvImportResponse> {
  const response = await fetch(resolveCsvImportsUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ fileName, networks }),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(buildErrorMessage(response.status, "Failed to persist CSV import", body));
  }

  return body as SaveCsvImportResponse;
}
