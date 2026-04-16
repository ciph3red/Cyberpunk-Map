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
  mergedWithImportId?: string;
}

interface CsvImportSummary {
  importId: string;
  fileName: string;
  networkCount: number;
  createdAt: string;
}

interface ListCsvImportsResponse {
  success: boolean;
  imports: CsvImportSummary[];
}

interface CsvImportDetailResponse {
  success: boolean;
  importId: string;
  fileName: string;
  networkCount: number;
  createdAt: string;
  totalResults: number;
  resultCount: number;
  results: WiFiNetwork[];
}

export interface LatestCsvImport {
  importId: string;
  fileName: string;
  networks: WiFiNetwork[];
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

function getFallbackSaveError(status: number): string {
  if (status === 413) {
    return "CSV payload too large to persist. Try a smaller import or increase server request limit.";
  }

  return "Failed to persist CSV import";
}

function getFallbackLoadError(): string {
  return "Failed to load saved CSV import";
}

async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
    throw new Error(buildErrorMessage(response.status, getFallbackSaveError(response.status), body));
  }

  return body as SaveCsvImportResponse;
}

export async function fetchCsvImportById(importId: string): Promise<LatestCsvImport> {
  const detailResponse = await fetch(`${resolveCsvImportsUrl()}/${encodeURIComponent(importId)}`, {
    method: "GET",
  });

  const detailBody = await parseJsonBody(detailResponse);

  if (!detailResponse.ok) {
    throw new Error(buildErrorMessage(detailResponse.status, getFallbackLoadError(), detailBody));
  }

  const detail = detailBody as CsvImportDetailResponse;
  const networks = Array.isArray(detail.results) ? detail.results : [];

  return {
    importId: detail.importId,
    fileName: detail.fileName,
    networks,
  };
}

export async function fetchLatestCsvImportFromServer(): Promise<LatestCsvImport | null> {
  const listResponse = await fetch(`${resolveCsvImportsUrl()}?limit=1`, {
    method: "GET",
  });

  const listBody = await parseJsonBody(listResponse);

  if (!listResponse.ok) {
    throw new Error(buildErrorMessage(listResponse.status, getFallbackLoadError(), listBody));
  }

  const listData = listBody as ListCsvImportsResponse;
  const latest = Array.isArray(listData.imports) ? listData.imports[0] : undefined;
  if (!latest?.importId) {
    return null;
  }

  return fetchCsvImportById(latest.importId);
}
