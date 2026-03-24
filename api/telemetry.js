// /api/telemetry.js
// Vercel Serverless Function — proxies Google Sheets API
// Secrets are read from environment variables (never exposed to the browser)

export default async function handler(req, res) {
  // CORS headers (allow your frontend to call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── Read secrets from environment variables ──────────────
  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
  const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
  const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet1";

  if (!API_KEY || !SPREADSHEET_ID) {
    return res.status(500).json({
      error: "Server misconfigured — missing GOOGLE_SHEETS_API_KEY or GOOGLE_SPREADSHEET_ID environment variables.",
    });
  }

  // ── Fetch data from Google Sheets API ────────────────────
  const range = encodeURIComponent(SHEET_NAME);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?key=${API_KEY}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message || `Google Sheets API returned ${response.status}`;
      return res.status(502).json({ error: msg });
    }

    const json = await response.json();
    const values = json.values;

    if (!values || values.length < 2) {
      return res.status(404).json({ error: "Sheet is empty or has no data rows." });
    }

    // ── Parse into row objects ──────────────────────────────
    const headers = values[0].map((h) => h.trim().toLowerCase());
    const rows = [];

    for (let i = 1; i < values.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = parseFloat(values[i][j]);
      }
      // Only include rows with a valid speed value
      if (!isNaN(row["speed_kmh"])) {
        rows.push(row);
      }
    }

    // // ── Cache for 60 seconds (reduces API calls) ────────────
    // res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    return res.status(200).json({
      rows,
      count: rows.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: `Failed to fetch from Google Sheets: ${err.message}`,
    });
  }
}
