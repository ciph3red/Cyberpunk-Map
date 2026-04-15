import { setBaseUrl, setExtraHeaders } from "@workspace/api-client-react";

export interface UserApiSettings {
  databaseApiUrl: string;
  wigleApiName: string;
  wigleApiToken: string;
}

const STORAGE_KEYS = {
  databaseApiUrl: "wigle-map.settings.databaseApiUrl",
  wigleApiName: "wigle-map.settings.wigleApiName",
  wigleApiToken: "wigle-map.settings.wigleApiToken",
} as const;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function normalizeText(value: string): string {
  return value.trim();
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadUserApiSettings(): UserApiSettings {
  if (!canUseStorage()) {
    return {
      databaseApiUrl: "",
      wigleApiName: "",
      wigleApiToken: "",
    };
  }

  return {
    databaseApiUrl: normalizeUrl(localStorage.getItem(STORAGE_KEYS.databaseApiUrl) ?? ""),
    wigleApiName: normalizeText(localStorage.getItem(STORAGE_KEYS.wigleApiName) ?? ""),
    wigleApiToken: normalizeText(localStorage.getItem(STORAGE_KEYS.wigleApiToken) ?? ""),
  };
}

export function saveUserApiSettings(settings: UserApiSettings): UserApiSettings {
  const normalized: UserApiSettings = {
    databaseApiUrl: normalizeUrl(settings.databaseApiUrl),
    wigleApiName: normalizeText(settings.wigleApiName),
    wigleApiToken: normalizeText(settings.wigleApiToken),
  };

  if (!canUseStorage()) {
    return normalized;
  }

  if (normalized.databaseApiUrl) {
    localStorage.setItem(STORAGE_KEYS.databaseApiUrl, normalized.databaseApiUrl);
  } else {
    localStorage.removeItem(STORAGE_KEYS.databaseApiUrl);
  }

  if (normalized.wigleApiName) {
    localStorage.setItem(STORAGE_KEYS.wigleApiName, normalized.wigleApiName);
  } else {
    localStorage.removeItem(STORAGE_KEYS.wigleApiName);
  }

  if (normalized.wigleApiToken) {
    localStorage.setItem(STORAGE_KEYS.wigleApiToken, normalized.wigleApiToken);
  } else {
    localStorage.removeItem(STORAGE_KEYS.wigleApiToken);
  }

  return normalized;
}

export function applyUserApiSettings(
  settings: UserApiSettings,
  fallbackDatabaseApiUrl: string | null,
): void {
  const effectiveBaseUrl = resolveDatabaseApiBaseUrl(
    settings,
    fallbackDatabaseApiUrl,
  );

  setBaseUrl(effectiveBaseUrl || null);

  const wigleApiName = normalizeText(settings.wigleApiName);
  const wigleApiToken = normalizeText(settings.wigleApiToken);

  if (wigleApiName && wigleApiToken) {
    setExtraHeaders({
      "x-wigle-api-name": wigleApiName,
      "x-wigle-api-token": wigleApiToken,
    });
    return;
  }

  setExtraHeaders(null);
}

export function resolveDatabaseApiBaseUrl(
  settings: UserApiSettings,
  fallbackDatabaseApiUrl: string | null,
): string {
  const databaseApiUrl = normalizeUrl(settings.databaseApiUrl);
  const fallback = normalizeUrl(fallbackDatabaseApiUrl ?? "");
  return databaseApiUrl || fallback || "";
}
