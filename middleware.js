'use strict';
var assert = require('assert');


var bufferedResponse = module.exports.bufferedResponse = function () {
  return function (req, res, next) {
    var output = [];
    var write = res.write;
    var end = res.end;

    res.write = function(chunk, encoding) {
      if (typeof chunk === 'string') {
        chunk = Buffer.from(chunk, encoding);
      }
      output.push(chunk);
      return true;
    };

    res.end = function(chunk, encoding) {
      if (typeof chunk === 'string') {
        chunk = Buffer.from(chunk, encoding);
      }
      if (!output.length) return end.call(this, chunk);
      if (chunk) {
        output.push(chunk);
      }
      res.write = write;
      end.call(this, Buffer.concat(output));
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
    res.end = function(body) {
      // assumes bufferedResponse
      if (!body) return end.call(this);
      res.removeHeader('Content-Length');
      body = transform(body, res);
      assert(typeof body !== 'string');
      res.setHeader('Content-Length', body.length);
      return end.call(this, body);
    };

    maybe_buffer(req, res, next);
  };
};
