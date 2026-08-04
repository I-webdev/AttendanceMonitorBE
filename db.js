// db.js
// Connection module for Neon (Serverless PostgreSQL).
//
// We use @neondatabase/serverless because it talks to Neon over
// HTTP/WebSockets, which works well in serverless/edge runtimes and
// avoids the cold-start cost of a raw TCP pool. If you deploy on a
// long-lived Node server instead, the plain `pg` Pool works exactly
// the same way — just swap the import (see comment below).

import { Pool } from '@neondatabase/serverless';
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to your .env file.');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Thin query helper so route handlers don't touch the pool directly.
 * @param {string} text - SQL text with $1, $2... placeholders
 * @param {any[]} params - query parameters
 */
export const query = (text, params) => pool.query(text, params);

// --- Alternative for a traditional long-lived Node server ---
// import pg from 'pg';
// export const pool = new pg.Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: { rejectUnauthorized: false }, // Neon requires SSL
// });
