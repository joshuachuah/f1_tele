// /api/_sheets.js
// Shared Google Sheets helper using Service Account (JWT auth)
// Supports both reading and writing — used by telemetry.js and snapshot.js

// ── JWT / Google Auth ──────────────────────────────────────

function base64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY");
  }

  // Fix escaped newlines (common in env vars)
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const signInput = `${header}.${payload}`;

  // Import the PEM key and sign
  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signInput}.${signature}`;

  // Exchange JWT for access token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google auth failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ── Read from a sheet tab ──────────────────────────────────

export async function readSheet(sheetName) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SPREADSHEET_ID");

  const token = await getAccessToken();
  const range = encodeURIComponent(sheetName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Sheets API ${res.status}`);
  }

  const json = await res.json();
  return json.values || [];
}

// ── Write to a sheet tab (overwrite entire range) ──────────

export async function writeSheet(sheetName, values) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SPREADSHEET_ID");

  const token = await getAccessToken();
  const range = encodeURIComponent(sheetName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range: sheetName, majorDimension: "ROWS", values }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Sheets write failed ${res.status}`);
  }

  return await res.json();
}

// ── Parse telemetry rows from raw sheet values ─────────────

export function parseRows(values) {
  if (!values || values.length < 2) return [];

  const headers = values[0].map((h) => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parseFloat(values[i][j]);
    }
    if (!isNaN(row["speed_kmh"])) rows.push(row);
  }

  return rows;
}
