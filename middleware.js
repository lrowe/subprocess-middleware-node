'use strict';
var assert = require('assert');


var bufferedResponse = module.exports.bufferedResponse = function () {
  return function (req, res, next) {
    var output = [];
    var write = res.write;
    var end = res.end;

    res.write = function(chunk, encoding, done) {
      if (typeof chunk === 'string') {
        chunk = new Buffer(chunk, encoding);
      }
      output.push(chunk);
      if (done) done();
      return true;
    };

    res.end = function(chunk, encoding, done) {
      res.write = write;
      if (!output.length) return end.call(this, chunk, encoding, done);
      if (typeof chunk === 'string') {
        chunk = new Buffer(chunk, encoding);
      }
      if (chunk) {
        output.push(chunk);
      }
      end.call(this, Buffer.concat(output), done);
    };

    next();
  };
};


var null_middleware = function(req, res, next) {
  next();
};


module.exports.transformResponse = function (transform, options) {
  options = options || {};
  // Really just in case you buffer elsewhere.
  var maybe_buffer = options.unbuffered ? null_middleware : bufferedResponse();

  return function (req, res, next) {
    var end = res.end;
    res.end = function(body, encoding, done) {
      // assumes bufferedResponse
      if (!body) return end.call(this, body, encoding, done);
      res.removeHeader('Content-Length');
      body = transform(body, res);
      assert(typeof body !== 'string');
      res.setHeader('Content-Length', body.length);
      return end.call(this, body, encoding, done);
    };

    maybe_buffer(req, res, next);
  };
};
