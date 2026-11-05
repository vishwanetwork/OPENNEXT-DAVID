'use strict';
// Where the interim backend keeps its state documents (accounts, Credit top-ups, marketplace,
// leads, caches). Each document is a whole JSON or text body, replaced atomically.
//
// - Files (default): one file per document under a data directory, written to a temporary file
//   and renamed, mode 0600. Local development and the tests use this.
// - MySQL (OPENNEXT_MYSQL_URL): one row per document in `legacy_documents`. The bundled adapter
//   reads the same table for its account, Credit and marketplace views.
//
// Services that read synchronously at construction (pricing, capacity) use readSync, writeLater
// and appendLater; with MySQL those are served from documents preloaded by openDocumentStore and
// written back in order in the background.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TABLE = 'legacy_documents';
const missing = name => Object.assign(new Error('Document not found: ' + name), {code: 'ENOENT'});
const exists = name => Object.assign(new Error('Document already exists: ' + name), {code: 'EEXIST'});

function validName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,190}$/.test(name) || name.split('/').includes('..')) throw Error('Invalid document name');
  return name;
}

function createFileDocumentStore(directory) {
  const root = path.resolve(directory);
  const file = name => path.join(root, validName(name));
  async function replace(name, text, flag) {
    const target = file(name);
    await fsp.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
    if (flag === 'wx') return fsp.writeFile(target, text, {flag: 'wx', mode: 0o600});
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    try {await fsp.writeFile(temporary, text, {flag: 'wx', mode: 0o600}); await fsp.rename(temporary, target);}
    catch (error) {await fsp.unlink(temporary).catch(() => {}); throw error;}
  }
  return {
    kind: 'file', directory: root,
    read: async name => fsp.readFile(file(name), 'utf8'),
    write: async (name, text) => replace(name, text),
    create: async (name, text) => replace(name, text, 'wx'),
    readSync(name) {
      try {return fs.readFileSync(file(name), 'utf8');} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    },
    writeLater(name, text) {
      const target = file(name), temporary = target + '.tmp';
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.writeFileSync(temporary, text, {mode: 0o600});
      fs.renameSync(temporary, target);
    },
    appendLater(name, text) {
      const target = file(name);
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.appendFileSync(target, text, {mode: 0o600});
    },
    flush: async () => {},
    close: async () => {},
  };
}

/** `mysql://` or SQLAlchemy's `mysql+pymysql://` URL, as the adapter uses. */
function mysqlOptions(url) {
  const parsed = new URL(String(url).replace(/^mysql\+[a-z0-9]+:/i, 'mysql:'));
  if (parsed.protocol !== 'mysql:' || !parsed.hostname || parsed.pathname.length < 2) throw Error('OPENNEXT_MYSQL_URL must be mysql://user:password@host:port/database');
  return {host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)), charset: 'utf8mb4', connectionLimit: 4, enableKeepAlive: true};
}

async function createMysqlDocumentStore(url, {preload = [], driver} = {}) {
  const mysql = driver || require('mysql2/promise');
  const pool = mysql.createPool(mysqlOptions(url));
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    name VARCHAR(191) NOT NULL PRIMARY KEY,
    body LONGTEXT NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  const cache = new Map();
  for (const name of preload.map(validName)) {
    const [rows] = await pool.query(`SELECT body FROM ${TABLE} WHERE name = ?`, [name]);
    cache.set(name, rows.length ? rows[0].body : null);
  }
  const upsert = (name, text) => pool.query(
    `INSERT INTO ${TABLE} (name, body, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [validName(name), text]);
  let queue = Promise.resolve(), failed = null;
  return {
    kind: 'mysql',
    async read(name) {
      const [rows] = await pool.query(`SELECT body FROM ${TABLE} WHERE name = ?`, [validName(name)]);
      if (!rows.length) throw missing(name);
      return rows[0].body;
    },
    async write(name, text) {await upsert(name, String(text));},
    async create(name, text) {
      try {await pool.query(`INSERT INTO ${TABLE} (name, body, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3))`, [validName(name), String(text)]);}
      catch (error) {if (error.code === 'ER_DUP_ENTRY') throw exists(name); throw error;}
    },
    readSync(name) {
      if (!cache.has(validName(name))) throw Error('Document was not preloaded: ' + name);
      return cache.get(name);
    },
    writeLater(name, text) {
      if (failed) {const error = failed; failed = null; throw error;}
      cache.set(validName(name), String(text));
      queue = queue.then(() => upsert(name, String(text))).catch(error => {failed = error;});
    },
    appendLater(name, text) {
      if (failed) {const error = failed; failed = null; throw error;}
      validName(name);
      cache.set(name, (cache.get(name) || '') + String(text));
      queue = queue.then(() => pool.query(
        `INSERT INTO ${TABLE} (name, body, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE body = CONCAT(body, VALUES(body)), updated_at = VALUES(updated_at)`,
        [name, String(text)])).catch(error => {failed = error;});
    },
    async flush() {await queue; if (failed) {const error = failed; failed = null; throw error;}},
    async close() {await queue.catch(() => {}); await pool.end();},
  };
}

/** The store for this process: MySQL when OPENNEXT_MYSQL_URL is set, otherwise files. */
async function openDocumentStore({env = process.env, dataDir, preload = []} = {}) {
  if (env.OPENNEXT_MYSQL_URL) return createMysqlDocumentStore(env.OPENNEXT_MYSQL_URL, {preload});
  return createFileDocumentStore(dataDir || env.OPENNEXT_DATA_DIR || path.join(__dirname, '.opennext-data'));
}

module.exports = {createFileDocumentStore, createMysqlDocumentStore, openDocumentStore, mysqlOptions, TABLE};
