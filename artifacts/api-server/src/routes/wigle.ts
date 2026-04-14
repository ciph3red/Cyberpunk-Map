import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const WIGLE_BASE = "https://api.wigle.net/api/v2";

function getWigleAuthHeader(): string {
  const token = process.env.WIGLE_API_TOKEN;
  if (!token) {
    throw new Error("WIGLE_API_TOKEN must be set");
  }
  // WiGLE provides an "Encoded for use" token on the API page — a pre-encoded
  // base64 credential. Use it directly as the Basic auth value.
  return `Basic ${token}`;
}

async function wigleFetch(path: string, params?: Record<string, string>): Promise<{ status: number; ok: boolean; text: string }> {
  const url = new URL(`${WIGLE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, v);
      }
    }
  }
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: getWigleAuthHeader(),
      Accept: "application/json",
    },
  });
  const text = await response.text();
  logger.info({ status: response.status, path, snippet: text.slice(0, 120) }, "WiGLE raw response");
  return { status: response.status, ok: response.ok, text };
}

function parseOrError(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, message: text.slice(0, 200) };
  }
}

router.get("/wigle/search", async (req, res) => {
  try {
    const {
      ssid,
      latrange1,
      latrange2,
      longrange1,
      longrange2,
      lastupdt,
      resultsPerPage,
      searchAfter,
      encryption,
    } = req.query as Record<string, string>;

    const params: Record<string, string> = {};
    if (ssid) params.ssid = ssid;
    if (latrange1) params.latrange1 = latrange1;
    if (latrange2) params.latrange2 = latrange2;
    if (longrange1) params.longrange1 = longrange1;
    if (longrange2) params.longrange2 = longrange2;
    if (lastupdt) params.lastupdt = lastupdt;
    if (resultsPerPage) params.resultsPerPage = resultsPerPage;
    if (searchAfter) params.searchAfter = searchAfter;
    if (encryption && encryption !== "any") params.encryption = encryption;

    const { status, ok, text } = await wigleFetch("/network/search", params);
    const data = parseOrError(text);

    if (!ok) {
      res.status(status).json(data);
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "WiGLE search error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/wigle/stats", async (req, res) => {
  try {
    const { ok, text } = await wigleFetch("/stats/site");
    if (ok) {
      const data = parseOrError(text);
      res.json({ success: true, ...(data as object) });
      return;
    }
    res.json({ success: true, nettotal: null });
  } catch (err) {
    req.log.error({ err }, "WiGLE stats error");
    res.json({ success: true, nettotal: null });
  }
});

router.get("/wigle/user/stats", async (req, res) => {
  try {
    const { status, ok, text } = await wigleFetch("/profile/user");
    const data = parseOrError(text);

    if (!ok) {
      res.status(status).json(data);
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "WiGLE user stats error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
