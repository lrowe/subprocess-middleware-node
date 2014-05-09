'use strict';

var BufferIO = require('./bufferio');
var HTTPParser = require('./http-parser').HTTPParser;
var Response = require('http').ServerResponse;
var assert = require('assert');
var stream = require('stream');
var util = require('util');

var DummyRequest = function() {
  this.url = '/';
  this.headers = {};
};

var noop = function () {};

DummyRequest.prototype.on = function () {};

// Gets delimited string data, and emits the parsed objects
var HTTPStream = module.exports.HTTPStream = function (options) {
  if (!(this instanceof HTTPStream)) {
    return new HTTPStream(options);
  }
  options = options || {};
  stream.Transform.call(this, options);
  var parser = this.parser = new HTTPParser(HTTPParser.RESPONSE);
  parser.onHeadersComplete = this.onHeadersComplete.bind(this);
  parser.onBody = this.onBody.bind(this);
  parser.onMessageComplete = this.onMessageComplete.bind(this);
  parser.preserveCase = true;
  this.app = options.app;
  this.connection = {
    _httpMessage: null,
    write: this.push.bind(this),
    writable: true
  };
  if (options.captureConsole) {
    this._stdout = console._stdout = new BufferIO();
    this._stderr = console._stderr = new BufferIO();
  }
};

util.inherits(HTTPStream, stream.Transform);

HTTPStream.prototype._transform = function(chunk, encoding, done) {
  var parser = this.parser;
  assert.equal(encoding, 'buffer');
  parser.execute(chunk, 0, chunk.length);

  while (parser.state === "UNINITIALIZED") {
    parser.reinitialize(HTTPParser.RESPONSE);
    if (parser.offset < parser.end) {
      parser.execute(parser.chunk, parser.offset, parser.end - parser.offset);
    }
  }

  done();
};

HTTPStream.prototype.onHeadersComplete = function(info) {
  var headers = info.headers;
  var name, value, existing;
  var res = this.res = new Response({});
  res.connection = this.connection;
  this.connection._httpMessage = res;
  this.connection.writable = true;

  if (this._stdout) this._stdout.clear();
  if (this._stderr) this._stderr.clear();

  function out(err) {
    if (err) throw new Error('Config error');
    res.statusCode = info.statusCode;
    res.statusMessage = info.statusMsg;
    res.sendDate = false;

    for (var i = 0, len = headers.length; i < len; i += 2) {
      name = headers[i];
      value = headers[i + 1];
      existing = res.getHeader(name);
      switch (typeof existing) {
        case 'string':
          value = [existing, value];
          break;
        case 'object':
          value = existing.push(value);
          break;
      }
      res.setHeader(name, value);
    }
  }

  if (this.app) {
    var req = new DummyRequest();
    try {
      this.app(req, res, out);
    } catch (err) {
      this.handle_error(err);
    }
  } else {
    out();
  }

};

HTTPStream.prototype.handle_error = function (err) {
  var res = this.res;
  if (res.headersSent) throw err;

  // Ignore rest of connection
  res.end = res.write = noop;
  res.connection = {
    _httpMessage: res,
    write: noop,
    writable: true
  };

  res = this.res = new Response({});
  res.connection = this.connection;
  this.connection._httpMessage = res;
  this.connection.writable = true;
  res.statusCode = 500;
  var body = 'Transform error\n\n' + err.stack;
  if (this._stdout) {
    body += '\n\n--log--\n' + this._stdout.toString(); 
  }
  if (this._stderr) {
    body += '\n\n--warn--\n' + this._stderr.toString(); 
  }
  body = new Buffer(body);
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.end(body);
};

HTTPStream.prototype.onBody = function(chunk, offset, length) {
  var res = this.res;
  var parser = this.parser;
  var part = chunk.slice(offset, offset + length);
  if (parser.state === "BODY_RAW" && parser.body_bytes === length) {
    try {
      res.end(part);
    } catch (err) {
      this.handle_error(err);
    }
  } else {
    try {
      res.write(part);
    } catch (err) {
      this.handle_error(err);
    }
  }
};

HTTPStream.prototype.onMessageComplete = function() {
  if (this.parser.state !== "BODY_RAW") {
    try {
      this.res.end();
    } catch (err) {
      this.handle_error(err);
    }
  }
};
