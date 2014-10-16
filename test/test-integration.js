'use strict';
var buster = require('buster');
var HTTPStream = require('../index').HTTPStream;
var BufferIO = require('../index').BufferIO;
var bufferedResponse = require('../index').bufferedResponse;
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

var long_content_body = new Buffer(130000);
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
    process.nextTick(done(function () {
      buster.assert.equals(out.toString(), chunks.join(''));
    }));
  };
}


function identity_transform(body, res) {
  return body;
}


function transform_test_case(chunks, transform, expect) {
  transform = transform || identity_transform;
  if (!expect) {
    expect = buster.assert.equals.bind(buster.assert, chunks.join(''));
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
    process.nextTick(done(function () {
      expect(out.toString());
    }));
  };
}


function connect_test_case(chunks, transform, expect) {
  transform = transform || identity_transform;
  if (!expect) {
    expect = buster.assert.equals.bind(buster.assert, chunks.join(''));
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
    process.nextTick(done(function () {
      expect(out.toString());
    }));
  };
}


[
  {name: 'HTTPStream identity', test: identity_test_case},
  {name: 'HTTPStream identity basic', test: transform_test_case},
  {name: 'HTTPStream identity connect', test: connect_test_case}
].forEach(function (test_case) {
  var test = test_case.test;

  buster.testCase(test_case.name, {
    'simple response': test([simple]),
    'multiple Set-Cookie': test([cookies]),
    'multiple response per chunk': test([simple + simple]),
    'response per chunk': test([simple, simple]),
    'body split over chunks': test([
      simple.slice(0, simple.length - 3),
      simple.slice(simple.length - 3)
    ]),
    'Long response hot=false': test([long_content])
  });

});


[
  {name: 'HTTPStream identity', test: identity_test_case},
].forEach(function (test_case) {
  var test = test_case.test;

  buster.testCase(test_case.name, {
    'no content length': test([no_content_length]),
  });

});


[
  {name: 'HTTPStream transform basic', test: transform_test_case},
  {name: 'HTTPStream transform connect', test: connect_test_case}
].forEach(function (test_case) {
  var test = test_case.test;

  buster.testCase(test_case.name, {
    'no content length': test(
      [no_content_length],
      null,
      function (result) {
        buster.assert.equals(result, [
          'HTTP/1.1 200 OK',
          'Connection: close',
          'Transfer-Encoding: identity',
          'Content-Length: 5',
          '',
          'Hello'
        ].join('\r\n'));
      }
      ),
    'transform changes content length': test(
      [simple],
      function (body, res) {
        res.setHeader('X-Test', 'true');
        return new Buffer('Transformed');
      },
      function (result) {
        buster.assert.equals(result, [
          'HTTP/1.1 200 OK',
          'Connection: keep-alive',
          'X-Test: true',
          'Content-Length: 11',
          '',
          'Transformed'
        ].join('\r\n'));
      }
    ),
    'transform error': test(
      [simple],
      function (body, res) {
        throw new Error('Transform error');
      },
      function (result) {
        var lines = result.split('\r\n');
        buster.assert.contains(lines, 'HTTP/1.1 500 Internal Server Error');
        buster.refute.contains(lines, 'Transfer-Encoding: chunked');
      }
    ),
    'transform error recovery': test(
      [x_test, simple],
      function (body, res) {
        if (res.getHeader('X-Test')) {
          throw new Error('Transform error');
        } else {
          return body;
        }
      },
      function (result) {
        var messages = result.split(/(?=HTTP\/1\.1)/);
        buster.assert.equals(messages.length, 2);
        var lines = messages[0].split('\r\n');
        buster.assert.contains(lines, 'HTTP/1.1 500 Internal Server Error');
        buster.refute.contains(lines, 'Transfer-Encoding: chunked');
        buster.assert.equals(messages[1], simple);
      }
    )
  });

});
