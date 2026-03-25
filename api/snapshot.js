// /api/snapshot.js
// POST → Fetches current telemetry, aggregates stats, writes to Snapshots tab
// GET  → Returns the current stored snapshot
// Called by Cowork scheduled task or manually via dashboard button

import { readSheet, writeSheet, parseRows } from "./_sheets.js";

function aggregate(rows) {
  const n = rows.length;
  const avg = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length;
  const max = (arr, key) => arr.reduce((m, r) => (r[key] > m ? r[key] : m), -Infinity);
  const min = (arr, key) => arr.reduce((m, r) => (r[key] < m ? r[key] : m), Infinity);

  const drsOn = rows.filter((r) => r.drs_active === 1);
  const drsOff = rows.filter((r) => r.drs_active !== 1);
  const stab100 = rows.filter((r) => r.stability_index >= 100).length;

  return {
    rowCount: n,
    avgSpeed: +avg(rows, "speed_kmh").toFixed(2),
    maxSpeed: +max(rows, "speed_kmh").toFixed(2),
    minSpeed: +min(rows, "speed_kmh").toFixed(2),
    avgDownforce: +avg(rows, "downforce_n").toFixed(2),
    maxDownforce: +max(rows, "downforce_n").toFixed(2),
    avgDrag: +avg(rows, "drag_n").toFixed(2),
    maxDrag: +max(rows, "drag_n").toFixed(2),
    drsPct: +(drsOn.length / n * 100).toFixed(2),
    drsCount: drsOn.length,
    avgStability: +avg(rows, "stability_index").toFixed(2),
    stab100Pct: +(stab100 / n * 100).toFixed(2),
    drsOnAvgDrag: +avg(drsOn, "drag_n").toFixed(2),
    drsOffAvgDrag: +avg(drsOff, "drag_n").toFixed(2),
    drsOnAvgDownforce: +avg(drsOn, "downforce_n").toFixed(2),
    drsOffAvgDownforce: +avg(drsOff, "downforce_n").toFixed(2),
    drsOnAvgSpeed: +avg(drsOn, "speed_kmh").toFixed(2),
    drsOffAvgSpeed: +avg(drsOff, "speed_kmh").toFixed(2),
    avgWingAngle: +avg(rows, "wing_angle_deg").toFixed(2),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  const DATA_SHEET = process.env.GOOGLE_SHEET_NAME || "Sheet1";
  const SNAP_SHEET = process.env.GOOGLE_SNAPSHOT_SHEET_NAME || "Snapshots";

  // ── GET: Return current snapshot ──────────────────────────
  if (req.method === "GET") {
    try {
      const snapValues = await readSheet(SNAP_SHEET);
      if (!snapValues || snapValues.length < 2) {
        return res.status(404).json({ error: "No snapshot exists yet." });
      }
      const keys = snapValues[0];
      const vals = snapValues[1];
      const snapshot = {};
      for (let i = 0; i < keys.length; i++) {
        const num = parseFloat(vals[i]);
        snapshot[keys[i]] = isNaN(num) ? vals[i] : num;
      }
      return res.status(200).json({ snapshot });
    } catch (err) {
      return res.status(500).json({ error: `Failed to read snapshot: ${err.message}` });
    }
  }

  // ── POST: Take a new snapshot ─────────────────────────────
  if (req.method === "POST") {
    try {
      // Fetch and aggregate current data
      const values = await readSheet(DATA_SHEET);
      const rows = parseRows(values);

      if (rows.length === 0) {
        return res.status(400).json({ error: "No data to snapshot." });
      }

      const stats = aggregate(rows);

      // Add metadata
      stats.snapshotAt = new Date().toISOString();
      stats.snapshotLabel = req.query.label || "Scheduled snapshot";

      // Write to Snapshots tab: row 0 = keys, row 1 = values
      const keys = Object.keys(stats);
      const vals = keys.map((k) => String(stats[k]));

      await writeSheet(SNAP_SHEET, [keys, vals]);

      return res.status(200).json({
        message: "Snapshot saved successfully.",
        snapshot: stats,
      });
    } catch (err) {
      return res.status(500).json({ error: `Snapshot failed: ${err.message}` });
    }
  }

  return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
}
