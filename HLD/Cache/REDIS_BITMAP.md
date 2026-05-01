# Redis bitmap (how it works)

Redis “bitmaps” are not a separate data type.
They’re stored inside a normal Redis **string value**, and Redis exposes bit operations to treat that string as a dense array of bits.

## Commands

- `SETBIT key offset 1|0` — set one bit at `offset`
- `GETBIT key offset` — read one bit
- `BITCOUNT key` — count bits set to 1 (useful for cardinality)
- `BITPOS key 1|0` — find first occurrence of a bit value

## Why it’s useful

A bitmap is extremely memory efficient for **presence / membership flags**:

- “Does userId 123 exist?”
- “Has userId 123 already been processed?”
- “Was this shard already scanned?”

For $N$ possible IDs, memory is roughly $N/8$ bytes.
Example: 1,000,000 possible IDs → ~125KB.

## How to use it for user presence

If your `userId` is numeric (0..N), you can directly map:

- key: `users:presence`
- offset: `userId`

Example (redis-cli):

- `SETBIT users:presence 123 1`
- `GETBIT users:presence 123` → `1`
- `GETBIT users:presence 999` → `0`

## If userId is a string

Bitmaps need a numeric `offset`. For string IDs you typically:

1. **Hash** the string to a number, then
2. `offset = hash % BIT_SIZE`

This becomes a **fast-negative filter** (similar to a very small Bloom filter):

- `GETBIT` = 0 → definitely not present
- `GETBIT` = 1 → might be present (hash collisions)

In this repo’s demo server (Bitmap.js), Redis caching uses `GET/SET` for the full value.
A Redis bitmap can optionally be added to quickly track “presence” or “seen” flags.
