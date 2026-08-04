// server.js
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import "dotenv/config";
import { query } from "./db.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Re-scans of the same name within this window are treated as
// duplicates (e.g. someone lingers in front of the camera, or
// scans again a minute later out of habit) rather than new check-ins.
const DUPLICATE_WINDOW_MINUTES =
  Number(process.env.DUPLICATE_WINDOW_MINUTES) || 5;

app.use(cors());
app.use(express.json());

// Malformed JSON bodies throw inside express.json() before reaching any
// route handler — catch that here so the client always gets a clean
// JSON error instead of Express's default HTML error page.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON in request body." });
  }
  next(err);
});

// ---------------------------------------------------------
// GET /api/attendance
// Returns all attendance records (newest first) + total count
// ---------------------------------------------------------
app.get("/api/attendance", async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT id, name, scanned_at FROM attendees ORDER BY scanned_at DESC",
    );

    res.status(200).json({
      attendees: rows,
      total: rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------
// POST /api/scan
// Body: { name: string }
//
// Duplicate handling: if the same name (case-insensitive) was scanned
// within the last DUPLICATE_WINDOW_MINUTES, no new row is inserted —
// the existing record is returned with status "duplicate" so the UI
// can give feedback without inflating the attendance count.
// Otherwise a new row is inserted and status is "success".
// ---------------------------------------------------------
app.post("/api/scan", async (req, res, next) => {
  const { name } = req.body ?? {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return res
      .status(400)
      .json({ error: 'A non-empty "name" string is required.' });
  }

  const cleanName = name.trim().slice(0, 255); // guard against oversized payloads

  try {
    const recentMatch = await query(
      `SELECT id, name, scanned_at
       FROM attendees
       WHERE LOWER(name) = LOWER($1)
         AND scanned_at > NOW() - ($2 || ' minutes')::interval
       ORDER BY scanned_at DESC
       LIMIT 1`,
      [cleanName, DUPLICATE_WINDOW_MINUTES],
    );

    if (recentMatch.rows.length > 0) {
      const countResult = await query(
        "SELECT COUNT(*)::int AS total FROM attendees",
      );
      return res.status(200).json({
        status: "duplicate",
        attendee: recentMatch.rows[0],
        total: countResult.rows[0].total,
        message: `${cleanName} already checked in within the last ${DUPLICATE_WINDOW_MINUTES} minutes.`,
      });
    }

    const insertResult = await query(
      `INSERT INTO attendees (name)
       VALUES ($1)
       RETURNING id, name, scanned_at`,
      [cleanName],
    );

    const countResult = await query(
      "SELECT COUNT(*)::int AS total FROM attendees",
    );

    res.status(201).json({
      status: "success",
      attendee: insertResult.rows[0],
      total: countResult.rows[0].total,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------
// Helpers for CSV export
// ---------------------------------------------------------

// Wrap a field in quotes and escape embedded quotes if it contains a
// comma, quote, or newline — standard CSV escaping.
function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  const header = "Name,Scanned At";
  const lines = rows.map(
    (row) =>
      `${csvEscape(row.name)},${csvEscape(new Date(row.scanned_at).toISOString())}`,
  );
  return [header, ...lines].join("\n");
}

// Constant-time-ish passcode comparison to avoid leaking length/content
// via response timing. Falls back to `false` on any length mismatch
// (timingSafeEqual requires equal-length buffers).
function isValidPasscode(candidate) {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || typeof candidate !== "string") return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------
// POST /api/export-csv
// Body: { passcode: string }
// Validates the admin passcode, then streams a CSV download
// of every attendance record.
// ---------------------------------------------------------
app.post("/api/export-csv", async (req, res, next) => {
  const { passcode } = req.body ?? {};

  if (!isValidPasscode(passcode)) {
    return res.status(401).json({ error: "Invalid admin passcode" });
  }

  try {
    const { rows } = await query(
      "SELECT name, scanned_at FROM attendees ORDER BY scanned_at DESC",
    );

    const csv = toCsv(rows);
    const filename = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;

    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------
// Health check (useful for uptime monitors / deploy checks)
// ---------------------------------------------------------
app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

// ---------------------------------------------------------
// 404 — unmatched routes get a clean JSON response, not HTML
// ---------------------------------------------------------
app.use((req, res) => {
  res
    .status(404)
    .json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

// ---------------------------------------------------------
// Final error handler — catches anything passed to next(err)
// above (DB failures, unexpected exceptions, etc.)
// ---------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
  console.log(`QR Attendance API listening on port ${PORT}`);
});

// // server.js
// import express from "express";
// import cors from "cors";
// import crypto from "node:crypto";
// import "dotenv/config";
// import { query } from "./db.js";

// const app = express();
// const PORT = process.env.PORT || 4000;

// app.use(cors());
// app.use(express.json());

// // ---------------------------------------------------------
// // GET /api/attendance
// // Returns all attendance records (newest first) + total count
// // ---------------------------------------------------------
// app.get("/api/attendance", async (req, res) => {
//   try {
//     const { rows } = await query(
//       "SELECT id, name, scanned_at FROM attendees ORDER BY scanned_at DESC",
//     );

//     res.status(200).json({
//       attendees: rows,
//       total: rows.length,
//     });
//   } catch (err) {
//     console.error("GET /api/attendance failed:", err);
//     res.status(500).json({ error: "Failed to fetch attendance records." });
//   }
// });

// // ---------------------------------------------------------
// // POST /api/scan
// // Body: { name: string }
// // Inserts a new attendee row, returns the row + updated total
// // ---------------------------------------------------------
// app.post("/api/scan", async (req, res) => {
//   const { name } = req.body ?? {};

//   if (typeof name !== "string" || name.trim().length === 0) {
//     return res
//       .status(400)
//       .json({ error: 'A non-empty "name" string is required.' });
//   }

//   const cleanName = name.trim().slice(0, 255); // guard against oversized payloads

//   try {
//     const insertResult = await query(
//       `INSERT INTO attendees (name)
//        VALUES ($1)
//        RETURNING id, name, scanned_at`,
//       [cleanName],
//     );

//     const countResult = await query(
//       "SELECT COUNT(*)::int AS total FROM attendees",
//     );

//     res.status(201).json({
//       attendee: insertResult.rows[0],
//       total: countResult.rows[0].total,
//     });
//   } catch (err) {
//     console.error("POST /api/scan failed:", err);
//     res.status(500).json({ error: "Failed to record scan." });
//   }
// });

// // ---------------------------------------------------------
// // Helpers for CSV export
// // ---------------------------------------------------------

// // Wrap a field in quotes and escape embedded quotes if it contains a
// // comma, quote, or newline — standard CSV escaping.
// function csvEscape(value) {
//   const str = String(value ?? "");
//   if (/[",\n]/.test(str)) {
//     return `"${str.replace(/"/g, '""')}"`;
//   }
//   return str;
// }

// function toCsv(rows) {
//   const header = "Name,Scanned At";
//   const lines = rows.map(
//     (row) =>
//       `${csvEscape(row.name)},${csvEscape(new Date(row.scanned_at).toISOString())}`,
//   );
//   return [header, ...lines].join("\n");
// }

// // Constant-time-ish passcode comparison to avoid leaking length/content
// // via response timing. Falls back to `false` on any length mismatch
// // (timingSafeEqual requires equal-length buffers).
// function isValidPasscode(candidate) {
//   const expected = process.env.ADMIN_PASSCODE;
//   if (!expected || typeof candidate !== "string") return false;

//   const a = Buffer.from(candidate);
//   const b = Buffer.from(expected);
//   if (a.length !== b.length) return false;

//   return crypto.timingSafeEqual(a, b);
// }

// // ---------------------------------------------------------
// // POST /api/export-csv
// // Body: { passcode: string }
// // Validates the admin passcode, then streams a CSV download
// // of every attendance record.
// // ---------------------------------------------------------
// app.post("/api/export-csv", async (req, res) => {
//   const { passcode } = req.body ?? {};

//   if (!isValidPasscode(passcode)) {
//     return res.status(401).json({ error: "Invalid admin passcode" });
//   }

//   try {
//     const { rows } = await query(
//       "SELECT name, scanned_at FROM attendees ORDER BY scanned_at DESC",
//     );

//     const csv = toCsv(rows);
//     const filename = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;

//     res.status(200);
//     res.setHeader("Content-Type", "text/csv; charset=utf-8");
//     res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
//     res.send(csv);
//   } catch (err) {
//     console.error("POST /api/export-csv failed:", err);
//     res.status(500).json({ error: "Failed to generate CSV export." });
//   }
// });

// // ---------------------------------------------------------
// // Health check (useful for uptime monitors / deploy checks)
// // ---------------------------------------------------------
// app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));

// app.listen(PORT, () => {
//   console.log(`QR Attendance API listening on port ${PORT}`);
// });
