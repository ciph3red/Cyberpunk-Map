import { Router } from "express";

const router = Router();

const WIGLE_BASE = "https://api.wigle.net/api/v2";

function getWigleAuthHeader(): string {
  const token = process.env.WIGLE_API_TOKEN;
  if (!token) {
    throw new Error("WIGLE_API_TOKEN must be set");
  }
  // WiGLE provides an "Encoded for use" token on the API page that is already
  // a base64-encoded name:token pair — use it directly as the Basic auth value.
  return `Basic ${token}`;
}

async function wigleFetch(path: string, params?: Record<string, string>): Promise<Response> {
  const url = new URL(`${WIGLE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, v);
      }
    }
  }
  return fetch(url.toString(), {
    headers: {
      Authorization: getWigleAuthHeader(),
      Accept: "application/json",
    },
  });
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

    const response = await wigleFetch("/network/search", params);
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json(data);
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
    // Try the main stats endpoint; fall back gracefully if unavailable
    const response = await wigleFetch("/stats/site");
    if (response.ok) {
      const data = await response.json();
      res.json({ success: true, ...data });
      return;
    }
    // If not available, return partial success so the UI doesn't break
    res.json({ success: true, nettotal: null });
  } catch (err) {
    req.log.error({ err }, "WiGLE stats error");
    res.json({ success: true, nettotal: null });
  }
});

router.get("/wigle/user/stats", async (req, res) => {
  try {
    const response = await wigleFetch("/profile/user");
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "WiGLE user stats error");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
