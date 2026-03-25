// /api/telemetry.js
// Returns live telemetry data AND the latest snapshot (if one exists)

import { readSheet, parseRows } from "./_sheets.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const DATA_SHEET = process.env.GOOGLE_SHEET_NAME || "Sheet1";
  const SNAP_SHEET = process.env.GOOGLE_SNAPSHOT_SHEET_NAME || "Snapshots";

  try {
    // Fetch live data
    const values = await readSheet(DATA_SHEET);
    const rows = parseRows(values);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No data rows found." });
    }

    // Fetch latest snapshot (may not exist yet)
    let snapshot = null;
    try {
      const snapValues = await readSheet(SNAP_SHEET);
      if (snapValues && snapValues.length >= 2) {
        // Snapshot sheet format: row 0 = keys, row 1 = values
        const keys = snapValues[0];
        const vals = snapValues[1];
        snapshot = {};
        for (let i = 0; i < keys.length; i++) {
          const v = vals[i];
          // Try to parse as number, keep as string if not
          const num = parseFloat(v);
          snapshot[keys[i]] = isNaN(num) ? v : num;
        }
      }
    } catch (e) {
      // Snapshot tab might not exist yet — that's fine
      snapshot = null;
    }

    return res.status(200).json({
      rows,
      count: rows.length,
      snapshot,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: `Failed to fetch data: ${err.message}`,
    });
  }
}
