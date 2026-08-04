// server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { query } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// GET /api/attendance
// Returns all attendance records (newest first) + total count
// ---------------------------------------------------------
app.get('/api/attendance', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, name, scanned_at FROM attendees ORDER BY scanned_at DESC'
    );

    res.status(200).json({
      attendees: rows,
      total: rows.length,
    });
  } catch (err) {
    console.error('GET /api/attendance failed:', err);
    res.status(500).json({ error: 'Failed to fetch attendance records.' });
  }
});

// ---------------------------------------------------------
// POST /api/scan
// Body: { name: string }
// Inserts a new attendee row, returns the row + updated total
// ---------------------------------------------------------
app.post('/api/scan', async (req, res) => {
  const { name } = req.body ?? {};

  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'A non-empty "name" string is required.' });
  }

  const cleanName = name.trim().slice(0, 255); // guard against oversized payloads

  try {
    const insertResult = await query(
      `INSERT INTO attendees (name)
       VALUES ($1)
       RETURNING id, name, scanned_at`,
      [cleanName]
    );

    const countResult = await query('SELECT COUNT(*)::int AS total FROM attendees');

    res.status(201).json({
      attendee: insertResult.rows[0],
      total: countResult.rows[0].total,
    });
  } catch (err) {
    console.error('POST /api/scan failed:', err);
    res.status(500).json({ error: 'Failed to record scan.' });
  }
});

// ---------------------------------------------------------
// Health check (useful for uptime monitors / deploy checks)
// ---------------------------------------------------------
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`QR Attendance API listening on port ${PORT}`);
});
