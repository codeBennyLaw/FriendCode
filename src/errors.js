"use strict";
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function assert(condition, status, message) { if (!condition) throw new HttpError(status, message); }
module.exports = { HttpError, assert };
