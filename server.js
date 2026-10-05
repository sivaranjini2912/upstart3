require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Create a .env file before starting the server.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const allowedStatuses = ['Pending', 'In Progress', 'Completed'];

function validateTask(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const status = typeof body.status === 'string' ? body.status : 'Pending';
  const errors = [];

  if (title.length < 3 || title.length > 100) {
    errors.push('Title must be between 3 and 100 characters.');
  }
  if (description.length > 500) {
    errors.push('Description must be 500 characters or fewer.');
  }
  if (!allowedStatuses.includes(status)) {
    errors.push('Status must be Pending, In Progress, or Completed.');
  }

  return { errors, values: { title, description, status } };
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// CREATE - POST /api/tasks
app.post('/api/tasks', async (req, res) => {
  const { errors, values } = validateTask(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [values.title, values.description || null, values.status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

// READ - GET /api/tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// READ ONE - GET /api/tasks/:id
app.get('/api/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task ID.' });
  }

  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch task.' });
  }
});

// UPDATE - PUT /api/tasks/:id
app.put('/api/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task ID.' });
  }

  const { errors, values } = validateTask(req.body);
  if (errors.length) return res.status(400).json({ errors });

  try {
    const result = await pool.query(
      `UPDATE tasks
       SET title = $1,
           description = $2,
           status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [values.title, values.description || null, values.status, id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// DELETE - DELETE /api/tasks/:id
app.delete('/api/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid task ID.' });
  }

  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json({ message: 'Task deleted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

// Serve frontend for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      description VARCHAR(500),
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT tasks_status_check CHECK (status IN ('Pending', 'In Progress', 'Completed'))
    );
  `);
}

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Could not connect to PostgreSQL:', error.message);
    process.exit(1);
  }
}

startServer();
