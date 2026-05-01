/*
	Simple (non-complex) MongoDB + Redis cache demo

	- no classes
	- only 3 endpoints
	- 1 endpoint to POST user data to MongoDB
	- 1 endpoint to GET user from MongoDB and return fetch time
	- 1 endpoint to GET user from Redis cache, fallback to MongoDB

	Install:
		npm i express mongodb redis

	Run:
		REDIS_URL="redis://localhost:6379" \
		MONGO_URI="mongodb://localhost:27017" \
		MONGO_DB="app" \
		MONGO_COLLECTION="users" \
		node HLD/Cache/Bitmap.js
*/

'use strict';

require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');

// -----------------------------
// Mongo + server
// -----------------------------

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;
const MONGO_COLLECTION = process.env.MONGO_COLLECTION;
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

if (!MONGO_URI || !MONGO_DB || !MONGO_COLLECTION) {
	// eslint-disable-next-line no-console
	console.error(
		'Missing env vars. Example:\n' +
			'  npm i express mongodb redis\n' +
			'  REDIS_URL="redis://localhost:6379" MONGO_URI="mongodb://localhost:27017" MONGO_DB="app" MONGO_COLLECTION="users" node HLD/Cache/Bitmap.js\n'
	);
	process.exitCode = 1;
} else {
	const app = express();
	app.use(express.json());

	const client = new MongoClient(MONGO_URI);
	let collection;

	const redis = createClient({ url: REDIS_URL });
	let redisReady = false;

	async function ensureConnected() {
		if (collection) return;
		await client.connect();
		collection = client.db(MONGO_DB).collection(MONGO_COLLECTION);
		// make userId queries fast
		await collection.createIndex({ userId: 1 }, { unique: true });
	}

	async function ensureRedis() {
		if (redisReady) return;
		redis.on('error', () => {
			// keep minimal; endpoint will return 500 if Redis is down
		});
		await redis.connect();
		redisReady = true;
	}

	async function fetchUserFromMongo(userId) {
		await ensureConnected();
		return collection.findOne({ userId: String(userId) });
	}

	function redisKeyForUser(userId) {
		return `user:${String(userId)}`;
	}

	async function cachePut(userId, userDoc) {
		await ensureRedis();
		await redis.set(redisKeyForUser(userId), JSON.stringify(userDoc));
		// Optional (documentation/demo): Redis can store bitmaps via SETBIT/GETBIT.
		// If userId is numeric, you can track presence efficiently:
		// const idx = Number(userId); if (Number.isInteger(idx) && idx >= 0) await redis.setBit('users:presence', idx, 1);
	}

	async function cacheGet(userId) {
		await ensureRedis();
		const value = await redis.get(redisKeyForUser(userId));
		return value ? JSON.parse(value) : null;
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
			await cachePut(doc.userId, doc);

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

	// (3) GET from Redis cache else MongoDB (and cache it)
	app.get('/user/:userId/cache', async (req, res) => {
		try {
			const { userId } = req.params;
			const cached = await cacheGet(userId);
			if (cached) return res.json({ ok: true, source: 'cache', data: cached });

			const start = Date.now();
			const doc = await fetchUserFromMongo(userId);
			const ms = Date.now() - start;

			if (!doc) return res.status(404).json({ ok: false, source: 'mongo', ms, error: 'not_found' });
			await cachePut(userId, doc);
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

