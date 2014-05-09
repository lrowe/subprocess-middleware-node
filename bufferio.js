'use strict';
var stream = require('stream');
var util = require('util');

var BufferIO = function(options) {
  if (!(this instanceof BufferIO))
    return new BufferIO(options);

  stream.Writable.call(this, options);
  this.clear();
};

util.inherits(BufferIO, stream.Writable);

BufferIO.prototype._write = function(chunk, encoding, done) {
  this.output.push(chunk);
  this.outputEncodings.push(encoding);
  done();
};

BufferIO.prototype.getValue = function() {
  return Buffer.concat(this.output.map(function (data, index) {
    return new Buffer(data, this.outputEncodings[index]);
  }.bind(this)));
};

BufferIO.prototype.toString = function(encoding) {
  return this.getValue().toString(encoding);
};

BufferIO.prototype.clear = function() {
  this.output = [];
  this.outputEncodings = [];
};

module.exports = BufferIO;
