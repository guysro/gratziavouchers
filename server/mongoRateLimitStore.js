// express-rate-limit store backed by MongoDB, so limits are shared across all
// serverless instances and survive cold starts. Documents expire through a TTL
// index on `resetAt` (created in api/index.js).

export class MongoRateLimitStore {
  localKeys = false;

  /**
   * @param {string} prefix Unique per limiter, so limiters never share counters.
   * @param {() => Promise<import("mongodb").Collection>} getCollection
   */
  constructor(prefix, getCollection) {
    this.prefix = `${prefix}:`;
    this.getCollection = getCollection;
    this.windowMs = 60 * 1000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const collection = await this.getCollection();
    const now = new Date();
    const windowExpired = {
      $or: [{ $not: ["$resetAt"] }, { $lte: ["$resetAt", now] }],
    };
    const update = [
      {
        $set: {
          hits: { $cond: [windowExpired, 1, { $add: ["$hits", 1] }] },
          resetAt: {
            $cond: [
              windowExpired,
              new Date(now.getTime() + this.windowMs),
              "$resetAt",
            ],
          },
        },
      },
    ];

    let document;
    try {
      document = await collection.findOneAndUpdate(
        { _id: this.prefix + key },
        update,
        { upsert: true, returnDocument: "after" },
      );
    } catch (error) {
      // Two concurrent first requests can race on the upsert; retry once.
      if (error?.code !== 11000) throw error;
      document = await collection.findOneAndUpdate(
        { _id: this.prefix + key },
        update,
        { returnDocument: "after" },
      );
    }

    return { totalHits: document.hits, resetTime: document.resetAt };
  }

  async decrement(key) {
    const collection = await this.getCollection();
    await collection.updateOne(
      { _id: this.prefix + key, resetAt: { $gt: new Date() }, hits: { $gt: 0 } },
      { $inc: { hits: -1 } },
    );
  }

  async resetKey(key) {
    const collection = await this.getCollection();
    await collection.deleteOne({ _id: this.prefix + key });
  }
}
