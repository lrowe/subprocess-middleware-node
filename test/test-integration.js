'use strict';
var expect = require('chai').expect;
var HTTPStream = require('../index').HTTPStream;
var BufferIO = require('../index').BufferIO;
var transformResponse = require('../index').transformResponse;
var connect = require('connect');

// Test data includes 'Connection: keep-alive' header as otherwise Node adds one.
var simple = [
  'HTTP/1.1 200 OK',
  'Connection: keep-alive',
  'Content-Length: 5',
  '',
  'Hello'
].join('\r\n');

var no_content_length = [
  'HTTP/1.1 200 OK',
  'Connection: close',
  'Transfer-Encoding: identity',
  '',
  'Hello'
].join('\r\n');

var x_test = [
  'HTTP/1.1 200 OK',
  'Connection: keep-alive',
  'X-Test: true',
  'Content-Length: 5',
  '',
  'Hello'
].join('\r\n');

var cookies = [
  'HTTP/1.1 200 OK',
  'Connection: keep-alive',
  'Set-Cookie: foo=bar',
  'Set-Cookie: a=b',
  'Content-Length: 5',
  '',
  'Hello'
].join('\r\n');

var long_content_body = Buffer.alloc(130000);
long_content_body.fill('b');

var long_content = [
  'HTTP/1.1 200 OK',
  'Connection: keep-alive',
  'Content-Length: ' + long_content_body.length,
  '',
  long_content_body.toString()
].join('\r\n');

function identity_test_case(chunks) {
  var close = chunks.join('\r\n').indexOf('Connection: close') != -1;

  return function (done) {
    var http_stream = new HTTPStream();
    var out = new BufferIO();
    http_stream.pipe(out);
    chunks.forEach(function (chunk) {
      http_stream.write(chunk);
    });
    if (close) {
      http_stream.end();
    }
    process.nextTick(function () {
      expect(out.toString()).to.equal(chunks.join(''));
      done();
    });
  };
}


function identity_transform(body, res) {
  res.sendDate = false;
  return body;
}


function transform_test_case(chunks, transform, check) {
  transform = transform || identity_transform;
  if (!check) {
    check = result => expect(result).to.equal(chunks.join(''));
  }
  var close = chunks.join('\r\n').indexOf('Connection: close') != -1;

  return function (done) {
    var app = transformResponse(transform);
    var http_stream = new HTTPStream({app: app});
    var out = new BufferIO();
    http_stream.pipe(out);
    chunks.forEach(function (chunk) {
      http_stream.write(chunk);
    });
    if (close) {
      http_stream.end();
    }
    process.nextTick(function () {
      check(out.toString());
      done();
    });
  };
}


function connect_test_case(chunks, transform, check) {
  transform = transform || identity_transform;
  if (!check) {
    check = result => expect(result).to.equal(chunks.join(''));
  }
  var close = chunks.join('\r\n').indexOf('Connection: close') != -1;

  return function (done) {
    var app = connect().use(transformResponse(transform));
    var http_stream = new HTTPStream({app: app});
    var out = new BufferIO();
    http_stream.pipe(out);
    chunks.forEach(function (chunk) {
      http_stream.write(chunk);
    });
    if (close) {
      http_stream.end();
    }
    process.nextTick(function () {
      check(out.toString());
      done();
    });
  };
}


[
  {name: 'HTTPStream identity', test: identity_test_case},
  {name: 'HTTPStream identity basic', test: transform_test_case},
  {name: 'HTTPStream identity connect', test: connect_test_case}
].forEach(function (test_case) {
  var test = test_case.test;

  describe(test_case.name, function () {
    it('simple response', test([simple]));
    it('multiple Set-Cookie', test([cookies]));
    it('multiple response per chunk', test([simple + simple]));
    it('response per chunk', test([simple, simple]));
    it('body split over chunks', test([
      simple.slice(0, simple.length - 3),
      simple.slice(simple.length - 3)
    ]));
    it('Long response hot=false', test([long_content]));
  });

});


[
  {name: 'HTTPStream identity', test: identity_test_case},
].forEach(function (test_case) {
  var test = test_case.test;

  describe(test_case.name, function () {
    it('no content length', test([no_content_length]));
  });

});


[
  {name: 'HTTPStream transform basic', test: transform_test_case},
  {name: 'HTTPStream transform connect', test: connect_test_case}
].forEach(function (test_case) {
  var test = test_case.test;

  describe(test_case.name, function () {
    it('no content length', test(
      [no_content_length],
      null,
      function (result) {
        expect(result).to.equal([
          'HTTP/1.1 200 OK',
          'Connection: close',
          'Transfer-Encoding: identity',
          'Content-Length: 5',
          '',
          'Hello'
        ].join('\r\n'));
      }
    ));
    it('transform changes content length', test(
      [simple],
      function (body, res) {
        res.sendDate = false;
        res.setHeader('X-Test', 'true');
        return Buffer.from('Transformed');
      },
      function (result) {
        expect(result).to.equal([
          'HTTP/1.1 200 OK',
          'Connection: keep-alive',
          'X-Test: true',
          'Content-Length: 11',
          '',
          'Transformed'
        ].join('\r\n'));
      }
    ));
    it('transform error', test(
      [simple],
      function (body, res) {
        res.sendDate = false;
        throw new Error('Transform error');
      },
      function (result) {
        expect(result).to.include('HTTP/1.1 500 Internal Server Error');
        expect(result).to.not.include('Transfer-Encoding: chunked');
      }
    ));
    it('transform error recovery', test(
      [x_test, simple],
      function (body, res) {
        res.sendDate = false;
        if (res.getHeader('X-Test')) {
          throw new Error('Transform error');
        } else {
          return body;
        }
      },
      function (result) {
        var messages = result.split(/(?=HTTP\/1\.1)/);
        expect(messages.length).to.equal(2);
        expect(result).to.include('HTTP/1.1 500 Internal Server Error');
        expect(result).to.not.include('Transfer-Encoding: chunked');
        expect(messages[1]).to.equal(simple);
      }
    ));
  });

});
