/**
 * Generates a real native SQLite database file used to test opening a
 * `.sqlite` / `.db` file (instead of a text SQL dump).
 *
 *   node scripts/make-sqlite-fixture.mjs
 *
 * Output: test/fixtures/shop.sqlite
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'test', 'fixtures', 'shop.sqlite');

mkdirSync(dirname(out), { recursive: true });
if (existsSync(out)) {
  // node:sqlite has no fs-level delete helper; recreate from scratch.
  const { rmSync } = await import('node:fs');
  rmSync(out, { force: true });
}

const db = new DatabaseSync(out);

db.exec(`
  PRAGMA journal_mode = DELETE;

  CREATE TABLE customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT    NOT NULL,
    email         TEXT    UNIQUE,
    country       CHAR(2),
    balance       REAL    DEFAULT 0,
    is_active     INTEGER DEFAULT 1,
    notes         TEXT,
    created_at    TEXT
  );

  CREATE TABLE products (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    category TEXT,
    price    NUMERIC NOT NULL
  );

  CREATE TABLE orders (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    placed_at   TEXT,
    status      TEXT DEFAULT 'pending',
    total       NUMERIC
  );

  CREATE TABLE order_items (
    id        INTEGER PRIMARY KEY,
    order_id  INTEGER REFERENCES orders(id),
    product_id INTEGER REFERENCES products(id),
    quantity  INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC
  );

  CREATE INDEX idx_orders_customer ON orders(customer_id);
  CREATE INDEX idx_items_order ON order_items(order_id);

  CREATE VIEW v_customer_orders AS
    SELECT c.full_name, c.country, o.id AS order_id, o.total
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id;
`);

const insertCustomer = db.prepare(
  `INSERT INTO customers (full_name, email, country, balance, is_active, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const customers = [
  ['سالم العتيبي', 'salem@example.com', 'SA', 1500.5, 1, 'عميل مميز', '2024-01-15 09:30:00'],
  ['Nora Ahmed', 'nora@example.com', 'AE', 320, 1, null, '2024-02-02 14:05:12'],
  ['خالد الشمري', 'khaled@example.com', 'KW', 0, 0, 'موقوف مؤقتًا', '2024-03-21 18:45:59'],
  ['Layla Hassan', 'layla@example.com', 'QA', 87.25, 1, 'Special customer', '2024-04-08 11:12:00'],
  ['عبدالله الفهد', 'abdullah@example.com', 'SA', 0, 1, null, '2024-05-19 07:45:03'],
  ['Sara Meyer', 'sara@example.com', 'DE', 2100.75, 1, 'High value', '2024-06-01 16:20:41'],
];
for (const row of customers) insertCustomer.run(...row);

const insertProduct = db.prepare(
  'INSERT INTO products (id, name, category, price) VALUES (?, ?, ?, ?)',
);
const products = [
  [1, 'لوحة مفاتيح ميكانيكية', 'إكسسوارات', 249.5],
  [2, 'شاشة 27 بوصة', 'شاشات', 1299],
  [3, 'قرص SSD 1TB', 'تخزين', 549.25],
  [4, 'ماوس لاسلكي', 'إكسسوارات', 89.9],
  [5, 'كرسي مكتب مريح', 'أثاث', 799],
];
for (const row of products) insertProduct.run(...row);

const insertOrder = db.prepare(
  'INSERT INTO orders (id, customer_id, placed_at, status, total) VALUES (?, ?, ?, ?, ?)',
);
const orders = [
  [1, 1, '2024-01-20 10:00:00', 'paid', 338.4],
  [2, 2, '2024-02-11 13:30:00', 'shipped', 1299],
  [3, 3, '2024-03-25 09:15:00', 'cancelled', 0],
  [4, 4, '2024-04-12 17:45:00', 'pending', 889.15],
  [5, 6, '2024-06-05 08:05:00', 'paid', 2248.75],
];
for (const row of orders) insertOrder.run(...row);

const insertItem = db.prepare(
  'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
);
const items = [
  [1, 1, 1, 1, 249.5],
  [2, 1, 4, 1, 89.9],
  [3, 2, 2, 1, 1299],
  [4, 4, 5, 1, 799],
  [5, 4, 3, 1, 549.25],
  [6, 5, 2, 1, 1299],
  [7, 5, 1, 1, 249.5],
  [8, 5, 3, 1, 549.25],
  [9, 5, 4, 1, 89.9],
  [10, 5, 5, 1, 799],
];
for (const row of items) insertItem.run(...row);

db.close();

const size = statSync(out).size;
console.log(`created ${out}`);
console.log(`size    ${size} bytes`);
