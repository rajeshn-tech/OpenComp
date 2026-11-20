/**
 * OpenComp - High-Performance Typed Buffer Memory Pool
 * Eliminates garbage-collection stalls by recycling Float32Array pixel buffers.
 * Supports standard VFX formats (720p, 1080p, 2K DCI, 4K UHD, and arbitrary sizes).
 */

export class BufferPool {
  constructor(maxPooledPerSize = 8) {
    this.maxPooled = maxPooledPerSize;
    /** @type {Map<number, Float32Array[]>} */
    this.pools = new Map();
    this.allocatedCount = 0;
    this.reusedCount = 0;
  }

  /**
   * Acquire a Float32Array of the exact required length
   * @param {number} length 
   * @returns {Float32Array}
   */
  acquire(length) {
    const list = this.pools.get(length);
    if (list && list.length > 0) {
      this.reusedCount++;
      return list.pop();
    }
    this.allocatedCount++;
    return new Float32Array(length);
  }

  /**
   * Acquire a Float32Array for an image with width, height, and channels
   * @param {number} width 
   * @param {number} height 
   * @param {number} channels 
   * @returns {Float32Array}
   */
  acquireForImage(width, height, channels = 4) {
    return this.acquire(width * height * channels);
  }

  /**
   * Return a typed array to the pool for future reuse
   * @param {Float32Array} array 
   */
  release(array) {
    if (!array || !(array instanceof Float32Array)) return;
    const len = array.length;
    let list = this.pools.get(len);
    if (!list) {
      list = [];
      this.pools.set(len, list);
    }
    if (list.length < this.maxPooled) {
      list.push(array);
    }
  }

  /**
   * Clear all pooled buffers to free memory
   */
  clear() {
    this.pools.clear();
    this.allocatedCount = 0;
    this.reusedCount = 0;
  }

  static clear() {
    globalBufferPool.clear();
  }

  /**
   * Get telemetry stats
   */
  getStats() {
    let totalCachedArrays = 0;
    let totalCachedBytes = 0;
    for (const [len, list] of this.pools.entries()) {
      totalCachedArrays += list.length;
      totalCachedBytes += list.length * len * 4;
    }
    return {
      allocatedCount: this.allocatedCount,
      reusedCount: this.reusedCount,
      cachedArrays: totalCachedArrays,
      cachedMemoryMB: (totalCachedBytes / (1024 * 1024)).toFixed(2)
    };
  }
}

// Global Singleton Buffer Pool for the compositing engine
export const globalBufferPool = new BufferPool(12);

