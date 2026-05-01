/*
  Simple (non-complex) MongoDB + Bitmap cache demo

  - no classes
  - only 3 endpoints
  - 1 endpoint to POST user data to MongoDB
  - 1 endpoint to GET user from MongoDB and return fetch time
  - 1 endpoint to GET user from cache (bitmap + Map), fallback to MongoDB

  Install:
    npm i express mongodb

  Run:
    MONGO_URI="mongodb://localhost:27017" \
    MONGO_DB="app" \
    MONGO_COLLECTION="users" \
    node HLD/Cache/Bitmap.js
*/

'use strict';

const express = require('express');
const { MongoClient } = require('mongodb');

// -----------------------------
// Minimal bitmap helpers
// -----------------------------

const BIT_SIZE = 1 << 20; // 1,048,576 bits (~128KB)
const BIT_WORDS = new Uint32Array(Math.ceil(BIT_SIZE / 32));

function fnv1a32(str) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function bitIndexForKey(key) {
	return fnv1a32(String(key)) % BIT_SIZE;
}

function bitmapSet(bitIndex) {
	const wordIndex = bitIndex >>> 5;
	const mask = 1 << (bitIndex & 31);
	BIT_WORDS[wordIndex] |= mask;
}

function bitmapTest(bitIndex) {
	const wordIndex = bitIndex >>> 5;
	const mask = 1 << (bitIndex & 31);
	return (BIT_WORDS[wordIndex] & mask) !== 0;
}

// NOTE: bitmap is only for "might have" checks (can have false positives)
// Real cached data is in this Map.
const CACHE = new Map(); // userId -> userDoc

function cachePut(userId, userDoc) {
	CACHE.set(String(userId), userDoc);
	bitmapSet(bitIndexForKey(userId));
}

function cacheGet(userId) {
	const key = String(userId);
	const bitIndex = bitIndexForKey(key);
	if (!bitmapTest(bitIndex)) return null;
	return CACHE.get(key) || null;
}

// -----------------------------
// Mongo + server
// -----------------------------

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;
const MONGO_COLLECTION = process.env.MONGO_COLLECTION;
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

if (!MONGO_URI || !MONGO_DB || !MONGO_COLLECTION) {
	// eslint-disable-next-line no-console
	console.error(
		'Missing env vars. Example:\n' +
			'  npm i express mongodb\n' +
			'  MONGO_URI="mongodb://localhost:27017" MONGO_DB="app" MONGO_COLLECTION="users" node HLD/Cache/Bitmap.js\n'
	);
	process.exitCode = 1;
} else {
	const app = express();
	app.use(express.json());

	const client = new MongoClient(MONGO_URI);
	let collection;

	async function ensureConnected() {
		if (collection) return;
		await client.connect();
		collection = client.db(MONGO_DB).collection(MONGO_COLLECTION);
		// make userId queries fast
		await collection.createIndex({ userId: 1 }, { unique: true });
	}

	async function fetchUserFromMongo(userId) {
		await ensureConnected();
		return collection.findOne({ userId: String(userId) });
	}

	// (1) POST user data -> MongoDB (and also cache it)
	app.post('/user', async (req, res) => {
		try {
			const body = req.body || {};
			const userId = body.userId;
			if (!userId) return res.status(400).json({ ok: false, error: 'userId_required' });

			await ensureConnected();
			const doc = { ...body, userId: String(userId), updatedAt: new Date() };

			await collection.updateOne({ userId: doc.userId }, { $set: doc }, { upsert: true });
			cachePut(doc.userId, doc);

			return res.json({ ok: true, source: 'mongo', cached: true, userId: doc.userId });
		} catch (err) {
			return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
		}
	});

	// (2) GET from MongoDB + return fetch time
	app.get('/user/:userId/db', async (req, res) => {
		try {
			const { userId } = req.params;
			const start = Date.now();
			const doc = await fetchUserFromMongo(userId);
			const ms = Date.now() - start;

			if (!doc) return res.status(404).json({ ok: false, source: 'mongo', ms, error: 'not_found' });
			return res.json({ ok: true, source: 'mongo', ms, data: doc });
		} catch (err) {
			return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
		}
	});

	// (3) GET from cache (bitmap+Map) else MongoDB (and cache it)
	app.get('/user/:userId/cache', async (req, res) => {
		try {
			const { userId } = req.params;
			const cached = cacheGet(userId);
			if (cached) return res.json({ ok: true, source: 'cache', data: cached });

			const start = Date.now();
			const doc = await fetchUserFromMongo(userId);
			const ms = Date.now() - start;

			if (!doc) return res.status(404).json({ ok: false, source: 'mongo', ms, error: 'not_found' });
			cachePut(userId, doc);
			return res.json({ ok: true, source: 'mongo_cached', ms, data: doc });
		} catch (err) {
			return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
		}
	});

	app.listen(PORT, () => {
		// eslint-disable-next-line no-console
		console.log(`Server listening on http://localhost:${PORT}`);
	});
}

