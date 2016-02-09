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

function noop_callback(data, encoding, callback) {
  if (typeof data === 'function') {
    callback = data;
    data = null;
  } else if (typeof encoding === 'function') {
    callback = encoding;
    encoding = null;
  }
  if (callback) callback();
}

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
    write: this._connection_write.bind(this),
    writable: true,
    cork: this.cork.bind(this),
    uncork: this.uncork.bind(this)
  };
  if (options.captureConsole) {
    this._stdout = console._stdout = new BufferIO();
    this._stderr = console._stderr = new BufferIO();
  }
this._newResponse();
};

util.inherits(HTTPStream, stream.Transform);

HTTPStream.prototype._transform = function(chunk, encoding, done) {
  assert.equal(encoding, 'buffer');
  this._execute(chunk, 0, chunk.length, done);
};

HTTPStream.prototype._execute = function(chunk, offset, length, done, reinit) {
  var parser = this.parser;
  if (reinit) {
    parser.reinitialize(HTTPParser.RESPONSE);
    this._newResponse();
  }
  if (length) {
    parser.execute(chunk, offset, length);
  }
  if (parser.state === "UNINITIALIZED") {
    this.res.on('finish', this._execute.bind(this, chunk, parser.offset, parser.end - parser.offset, done, true));
  } else {
    done();
  }
};

HTTPStream.prototype._newResponse = function() {
  var res = this.res = new Response({});
  res.connection = this.connection;
  res._started = false;
  res._queued_writes = [];
  res._queued_end = false;
  this.connection._httpMessage = res;
  this.connection.writable = true;

  if (this._stdout) this._stdout.clear();
  if (this._stderr) this._stderr.clear();
};

HTTPStream.prototype._connection_write = function(chunk, encoding, done) {
  this.push(chunk);
  if (done) done();
};

HTTPStream.prototype.onHeadersComplete = function(info) {
  var stream = this;
  var headers = info.headers;
  var name, value, existing;
  var res = this.res;

  function out(err) {
    //if (err) throw new Error('Config error');
    if (err) {
        stream.handle_error(err);
        return;
    }
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

    res._started = true;
    
    if (res._queued_writes.length) {
      var data = Buffer.concat(res._queued_writes);
      res._queued_writes = [];
      try {
        if (res._queued_end) {
          res.end(data);
        } else {
          res.write(data);
        }
      } catch (err) {
        stream.handle_error(err);
        if (res._queued_end) {
          res.end();
        }
      }
    } else if (res._queued_end) {
      try {
        res.end();
      } catch (err) {
        stream.handle_error(err);
        res.end();
      }
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
    setImmediate(out);
  }
};

HTTPStream.prototype.handle_error = function (err) {
  var stream = this;
  var res = this.res;
  if (res.headersSent) throw err;
  res._erred = true;

  // Ignore rest of connection

  res.write = noop_callback;

  res.end = function(data, encoding, callback) {
    if (typeof data === 'function') {
      callback = data;
      data = null;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = null;
    }
    var body = 'Transform error\n\n' + err.stack;
    if (this._stdout) {
      body += '\n\n--log--\n' + this._stdout.toString(); 
    }
    if (this._stderr) {
      body += '\n\n--warn--\n' + this._stderr.toString(); 
    }
    var message = [
      'HTTP/1.1 500 Internal Server Error',
      'Connection: keep-alive',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Length: ' + Buffer.byteLength(body, 'utf-8'),
      '',
      body
    ].join('\r\n')
    stream.push(new Buffer(message, 'utf-8'))
    res.emit('finish');
    if (callback) callback();
    res.end = noop_callback;
  };

};

HTTPStream.prototype.onBody = function(chunk, offset, length) {
  if (this.res._erred) {
      return;
  }
  var part = chunk.slice(offset, offset + length);
  if (!this.res._started) {
      this.res._queued_writes.push(part);
  } else {
    try {
      this.res.write(part);
    } catch (err) {
      this.handle_error(err);
    }
  }
};

HTTPStream.prototype.onMessageComplete = function() {
  if (!this.res._started) {
    this.res._queued_end = true;
  } else {
    try {
      this.res.end();
    } catch (err) {
      this.handle_error(err);
      setImmediate(this.res.end.bind(this.res));
    }
  }
};

HTTPStream.prototype._flush = function(done) {
  if (this.parser.state === "BODY_RAW") {
    this.res.on('finish', done);
    this.onMessageComplete();
  } else {
    if (done) done();
  }
};
