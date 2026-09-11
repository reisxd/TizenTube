"use strict";

var net = require("net");
var tls = require("tls");
var stream = require("stream");
var util = require("util");

var Writable = stream.Writable;
var PassThrough = stream.PassThrough;

function copyHeaders(headers) {
    var result = {};

    Object.keys(headers || {}).forEach(function (name) {
        result[name] = headers[name];
    });

    return result;
}

function hasHeader(headers, wanted) {
    var wantedLower = wanted.toLowerCase();

    return Object.keys(headers).some(function (name) {
        return name.toLowerCase() === wantedLower;
    });
}

function parseUrl(value) {
    var match =
        /^(?:https:)?\/\/([^\/?:]+)(?::([0-9]+))?(\/[^?]*)?(\?.*)?$/i.exec(
            String(value)
        );

    if (!match) {
        throw new Error("Invalid HTTPS URL: " + value);
    }

    return {
        protocol: "https:",
        hostname: match[1],
        host: match[1],
        port: match[2] ? Number(match[2]) : 443,
        path: (match[3] || "/") + (match[4] || ""),
    };
}

function normalizeOptions(input, options, callback) {
    var result;

    if (typeof input === "string") {
        result = parseUrl(input);
    } else if (input && typeof input.href === "string") {
        result = parseUrl(input.href);
    } else {
        result = {};

        Object.keys(input || {}).forEach(function (key) {
            result[key] = input[key];
        });
    }

    if (options && typeof options === "object") {
        Object.keys(options).forEach(function (key) {
            if (key !== "headers") {
                result[key] = options[key];
            }
        });

        result.headers = copyHeaders(options.headers);
    } else {
        result.headers = copyHeaders(result.headers);
    }

    if (!result.method) {
        result.method = "GET";
    }

    result.method = String(result.method).toUpperCase();

    if (!result.hostname) {
        result.hostname = result.host;
    }

    if (!result.host) {
        result.host = result.hostname;
    }

    if (!result.port) {
        result.port = 443;
    }

    if (!result.path) {
        result.path = "/";
    }

    result.callback = callback;

    return result;
}

function ResponseParser(request) {
    this.request = request;
    this.buffer = new Buffer(0);
    this.headersParsed = false;
    this.response = null;
    this.contentLength = null;
    this.chunked = false;
    this.chunkRemaining = null;
    this.complete = false;
}

ResponseParser.prototype.push = function (chunk) {
    if (this.complete) {
        return;
    }

    if (chunk && chunk.length) {
        if (this.buffer.length) {
            this.buffer = Buffer.concat([this.buffer, chunk]);
        } else {
            this.buffer = chunk;
        }
    }

    while (!this.complete) {
        if (!this.headersParsed) {
            if (!this.parseHeaders()) {
                return;
            }
        }

        if (this.chunked) {
            if (!this.parseChunked()) {
                return;
            }

            continue;
        }

        if (this.contentLength !== null) {
            if (!this.parseFixedLength()) {
                return;
            }

            continue;
        }

        if (this.buffer.length) {
            this.emitResponse();
            this.response.write(this.buffer);
            this.buffer = new Buffer(0);
        }

        return;
    }
};

ResponseParser.prototype.parseHeaders = function () {
    var headerEnd = this.buffer.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
        return false;
    }

    var headerBuffer = this.buffer.slice(0, headerEnd);
    this.buffer = this.buffer.slice(headerEnd + 4);

    var text = headerBuffer.toString("binary");
    var lines = text.split("\r\n");
    var statusLine = lines.shift() || "";

    var match = /^HTTP\/([0-9.]+)\s+([0-9]{3})(?:\s+(.*))?$/.exec(statusLine);

    if (!match) {
        this.request.fail(new Error("Invalid HTTP response: " + statusLine));
        return false;
    }

    var statusCode = Number(match[2]);

    if (statusCode >= 100 && statusCode < 200 && statusCode !== 101) {
        return this.parseHeaders();
    }

    var headers = {};

    lines.forEach(function (line) {
        var colon = line.indexOf(":");

        if (colon <= 0) {
            return;
        }

        var name = line.slice(0, colon).toLowerCase();

        var value = line.slice(colon + 1).replace(/^\s+|\s+$/g, "");

        if (headers[name] === undefined) {
            headers[name] = value;
        } else {
            headers[name] += ", " + value;
        }
    });

    this.response = new PassThrough();
    this.response.statusCode = statusCode;
    this.response.statusMessage = match[3] || "";
    this.response.httpVersion = match[1];
    this.response.headers = headers;
    this.headersParsed = true;
    this.emitResponse();

    if (
        this.request.method === "HEAD" ||
        statusCode === 204 ||
        statusCode === 304 ||
        (statusCode >= 100 && statusCode < 200)
    ) {
        this.contentLength = 0;

        return true;
    }

    var transferEncoding = headers["transfer-encoding"];

    if (transferEncoding && /(^|,)\s*chunked\s*(,|$)/i.test(transferEncoding)) {
        this.chunked = true;
        return true;
    }

    if (headers["content-length"] !== undefined) {
        var length = parseInt(headers["content-length"], 10);

        if (!isFinite(length) || length < 0) {
            this.request.fail(new Error("Invalid Content-Length"));
            return false;
        }

        this.contentLength = length;
        return true;
    }

    this.contentLength = null;
    return true;
};

ResponseParser.prototype.emitResponse = function () {
    if (!this.response) {
        return;
    }

    if (this.request.responseEmitted) {
        return;
    }

    this.request.responseEmitted = true;
    this.request.response = this.response;

    if (typeof this.request.callback === "function") {
        this.request.callback(this.response);
    }
};

ResponseParser.prototype.parseFixedLength = function () {
    if (this.contentLength === 0) {
        this.completeResponse();
        return true;
    }

    if (!this.buffer.length) {
        return false;
    }

    var count = Math.min(this.contentLength, this.buffer.length);

    this.emitResponse();
    this.response.write(this.buffer.slice(0, count));
    this.buffer = this.buffer.slice(count);
    this.contentLength -= count;

    if (this.contentLength === 0) {
        this.completeResponse();
    }

    return true;
};

ResponseParser.prototype.parseChunked = function () {
    while (!this.complete) {
        if (this.chunkRemaining === null) {
            var lineEnd = this.buffer.indexOf("\r\n");

            if (lineEnd === -1) {
                return false;
            }

            var line = this.buffer.slice(0, lineEnd).toString("ascii");
            this.buffer = this.buffer.slice(lineEnd + 2);
            var semi = line.indexOf(";");

            if (semi !== -1) {
                line = line.slice(0, semi);
            }

            line = line.replace(/^\s+|\s+$/g, "");
            var size = parseInt(line, 16);

            if (!isFinite(size) || size < 0) {
                this.request.fail(new Error("Invalid chunk size"));

                return false;
            }

            if (size === 0) {
                if (
                    this.buffer.length >= 2 &&
                    this.buffer[0] === 13 &&
                    this.buffer[1] === 10
                ) {
                    this.buffer = this.buffer.slice(2);
                    this.completeResponse();
                    return true;
                }

                var trailerEnd = this.buffer.indexOf("\r\n\r\n");

                if (trailerEnd === -1) {
                    return false;
                }

                this.buffer = this.buffer.slice(trailerEnd + 4);
                this.completeResponse();
                return true;
            }

            this.chunkRemaining = size;
        }

        if (!this.buffer.length) {
            return false;
        }

        var count = Math.min(this.chunkRemaining, this.buffer.length);
        this.emitResponse();
        this.response.write(this.buffer.slice(0, count));
        this.buffer = this.buffer.slice(count);
        this.chunkRemaining -= count;

        if (this.chunkRemaining === 0) {
            if (this.buffer.length < 2) {
                return false;
            }

            if (this.buffer[0] !== 13 || this.buffer[1] !== 10) {
                this.request.fail(new Error("Invalid chunk terminator"));
                return false;
            }

            this.buffer = this.buffer.slice(2);
            this.chunkRemaining = null;
        }
    }

    return true;
};

ResponseParser.prototype.end = function () {
    if (this.complete) {
        return;
    }

    if (this.headersParsed && this.contentLength === null && !this.chunked) {
        if (this.buffer.length) {
            this.emitResponse();
            this.response.write(this.buffer);
            this.buffer = new Buffer(0);
        }

        this.completeResponse();
        return;
    }

    if (this.headersParsed && this.contentLength === 0) {
        this.completeResponse();
        return;
    }

    this.request.fail(new Error("Premature HTTPS connection close"));
};

ResponseParser.prototype.completeResponse = function () {
    if (this.complete) {
        return;
    }

    this.complete = true;

    if (this.response) {
        this.emitResponse();
        this.response.end();
    }

    this.request.responseComplete();
};

function ClientRequest(options) {
    Writable.call(this);

    this.options = options;
    this.method = String(options.method || "GET").toUpperCase();
    this.callback = options.callback;
    this.headers = copyHeaders(options.headers);
    this.socket = null;
    this.tcpSocket = null;
    this.parser = null;
    this.requestSent = false;
    this.responseEmitted = false;
    this.response = null;
    this.aborted = false;
    this.body = [];
    this.ended = false;

    if (!hasHeader(this.headers, "host")) {
        this.headers.Host = options.hostname;
        if (Number(options.port) !== 443) {
            this.headers.Host += ":" + options.port;
        }
    }

    if (!hasHeader(this.headers, "connection")) {
        this.headers.Connection = "close";
    }

    this.once(
        "finish",
        function () {
            this.ended = true;
            this.sendRequest();
        }.bind(this)
    );

    this.connect();
}

util.inherits(ClientRequest, Writable);

ClientRequest.prototype.connect = function () {
    var self = this;
    var hostname = this.options.hostname || this.options.host;
    var port = this.options.port || 443;
    var tcp = net.connect(port, hostname);
    this.tcpSocket = tcp;

    tcp.setTimeout(15000, function () {
        self.fail(new Error("TCP connection timeout"));
    });

    tcp.once("connect", function () {
        var tlsOptions = {
            socket: tcp,
            servername: self.options.servername || hostname,
            rejectUnauthorized: self.options.rejectUnauthorized !== false,
        };

        if (process.features && process.features.tls_npn) {
            tlsOptions.NPNProtocols = ["http/1.1"];
        }

        if (self.options.ca !== undefined) {
            tlsOptions.ca = self.options.ca;
        }

        if (self.options.cert !== undefined) {
            tlsOptions.cert = self.options.cert;
        }

        if (self.options.key !== undefined) {
            tlsOptions.key = self.options.key;
        }

        if (self.options.pfx !== undefined) {
            tlsOptions.pfx = self.options.pfx;
        }

        if (self.options.passphrase !== undefined) {
            tlsOptions.passphrase = self.options.passphrase;
        }

        if (self.options.ciphers !== undefined) {
            tlsOptions.ciphers = self.options.ciphers;
        }

        if (self.options.secureProtocol !== undefined) {
            tlsOptions.secureProtocol = self.options.secureProtocol;
        }

        var secure;

        try {
            secure = tls.connect(tlsOptions);
        } catch (error) {
            self.fail(error);
            return;
        }

        self.socket = secure;

        secure.once("secureConnect", function () {
            if (!secure.authorized && self.options.rejectUnauthorized !== false) {
                self.fail(
                    new Error(secure.authorizationError || "TLS authorization failed")
                );

                return;
            }

            self.installSocket();
            self.sendRequest();
        });

        secure.on("error", function (error) {
            self.fail(error);
        });

        secure.on("end", function () {
            if (!self.aborted && self.parser) {
                self.parser.end();
            }
        });

        secure.on("close", function () {
            if (!self.aborted && self.parser && !self.parser.complete) {
                self.parser.end();
            }
        });
    });

    tcp.once("error", function (error) {
        self.fail(error);
    });
};

ClientRequest.prototype.installSocket = function () {
    var self = this;

    if (this.parser) {
        return;
    }

    this.parser = new ResponseParser(this);

    this.socket.on("data", function (chunk) {
        if (!self.aborted) {
            self.parser.push(chunk);
        }
    });
};

ClientRequest.prototype._write = function (chunk, encoding, callback) {
    if (this.aborted) {
        callback(new Error("Request aborted"));
        return;
    }

    var buffer;

    if (Buffer.isBuffer(chunk)) {
        buffer = chunk;
    } else {
        if (
            encoding === "utf8" ||
            encoding === "utf-8" ||
            encoding === "ascii" ||
            encoding === "binary" ||
            !encoding
        ) {
            buffer = new Buffer(chunk, encoding || "utf8");
        } else {
            buffer = new Buffer(String(chunk), "utf8");
        }
    }

    if (this.requestSent) {
        this.socket.write(buffer);
    } else {
        this.body.push(buffer);
    }

    callback();
};

ClientRequest.prototype.sendRequest = function () {
    if (this.aborted) {
        return;
    }

    if (this.requestSent) {
        return;
    }

    if (!this.socket) {
        return;
    }

    if (!this.ended) {
        return;
    }

    var self = this;
    var lines = [];

    Object.keys(this.headers).forEach(function (name) {
        var value = self.headers[name];

        if (Array.isArray(value)) {
            value = value.join(", ");
        }

        lines.push(name + ": " + value);
    });

    var requestText =
        this.method +
        " " +
        this.options.path +
        " HTTP/1.1\r\n" +
        lines.join("\r\n") +
        "\r\n\r\n";

    try {
        this.socket.write(requestText);

        for (var i = 0; i < this.body.length; i++) {
            this.socket.write(this.body[i]);
        }

        this.body = [];
        this.requestSent = true;
    } catch (error) {
        this.fail(error);
    }
};

ClientRequest.prototype.setTimeout = function (timeout, callback) {
    var self = this;

    if (callback) {
        this.once("timeout", callback);
    }

    var target = this.socket || this.tcpSocket;

    if (target) {
        target.setTimeout(timeout, function () {
            self.emit("timeout");
        });
    }

    return this;
};

ClientRequest.prototype.abort = function () {
    if (this.aborted) {
        return this;
    }

    this.aborted = true;

    if (this.socket) {
        this.socket.destroy();
    }

    if (this.tcpSocket && this.tcpSocket !== this.socket) {
        this.tcpSocket.destroy();
    }

    if (this.response) {
        this.response.destroy && this.response.destroy();
    }

    this.emit("abort");

    return this;
};

ClientRequest.prototype.fail = function (error) {
    if (this.aborted) {
        return;
    }

    this.aborted = true;

    if (this.socket) {
        this.socket.destroy();
    }

    if (this.tcpSocket && this.tcpSocket !== this.socket) {
        this.tcpSocket.destroy();
    }

    if (this.response) {
        this.response.destroy();
    }

    this.emit("error", error);
};

ClientRequest.prototype.responseComplete = function () {
    if (this.socket) {
        this.socket.destroy();
    }
};

function request(input, optionsOrCallback, callback) {
    var callbackFn =
        typeof optionsOrCallback === "function" ? optionsOrCallback : callback;

    var options =
        typeof optionsOrCallback === "object" ? optionsOrCallback : null;

    var normalized = normalizeOptions(input, options, callbackFn);

    return new ClientRequest(normalized);
}

function get(input, optionsOrCallback, callback) {
    var req = request(input, optionsOrCallback, callback);
    req.end();

    return req;
}

module.exports = {
    request: request,
    get: get,
};