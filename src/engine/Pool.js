class Pool {
  constructor(sortedItems) { this._arr = sortedItems; this._dead = new Set(); }
  get length() { return this._arr.length - this._dead.size; }
  remove(it) { this._dead.add(it.idx); }
  topN(n = 220) {
    const out = [];
    for (const it of this._arr) { if (this._dead.has(it.idx)) continue; out.push(it); if (out.length >= n) break; }
    return out;
  }
  popWhere(pred) {
    for (const it of this._arr) { if (!this._dead.has(it.idx) && pred(it)) { this._dead.add(it.idx); return it; } }
    return null;
  }
  shift() { return this.popWhere(() => true); }
  maybeCompact() {
    if (this._dead.size >= 300 && this._dead.size >= this._arr.length * 0.4) {
      this._arr = this._arr.filter(it => !this._dead.has(it.idx)); this._dead.clear();
    }
  }
}
module.exports = Pool;
