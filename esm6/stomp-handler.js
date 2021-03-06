import { Byte } from "./byte";
import { Versions } from "./versions";
import { Frame } from "./frame";
import { Parser } from "./parser";
/**
 * The STOMP protocol handler
 *
 * @internal
 */
var StompHandler = /** @class */ (function () {
    function StompHandler(_client, _webSocket, config) {
        if (config === void 0) { config = {}; }
        var _this = this;
        this._client = _client;
        this._webSocket = _webSocket;
        this._serverFrameHandlers = {
            // [CONNECTED Frame](http://stomp.github.com/stomp-specification-1.2.html#CONNECTED_Frame)
            'CONNECTED': function (frame) {
                _this.debug("connected to server " + frame.headers.server);
                _this._connected = true;
                _this._connectedVersion = frame.headers.version;
                // STOMP version 1.2 needs header values to be escaped
                if (_this._connectedVersion === Versions.V1_2) {
                    _this._escapeHeaderValues = true;
                }
                _this._setupHeartbeat(frame.headers);
                _this.onConnect(frame);
            },
            // [MESSAGE Frame](http://stomp.github.com/stomp-specification-1.2.html#MESSAGE)
            "MESSAGE": function (frame) {
                // the callback is registered when the client calls
                // `subscribe()`.
                // If there is no registered subscription for the received message,
                // the default `onUnhandledMessage` callback is used that the client can set.
                // This is useful for subscriptions that are automatically created
                // on the browser side (e.g. [RabbitMQ's temporary
                // queues](http://www.rabbitmq.com/stomp.html)).
                var subscription = frame.headers.subscription;
                var onReceive = _this._subscriptions[subscription] || _this.onUnhandledMessage;
                // bless the frame to be a Message
                var message = frame;
                var client = _this;
                var messageId = _this._connectedVersion === Versions.V1_2 ? message.headers["ack"] : message.headers["message-id"];
                // add `ack()` and `nack()` methods directly to the returned frame
                // so that a simple call to `message.ack()` can acknowledge the message.
                message.ack = function (headers) {
                    if (headers === void 0) { headers = {}; }
                    return client.ack(messageId, subscription, headers);
                };
                message.nack = function (headers) {
                    if (headers === void 0) { headers = {}; }
                    return client.nack(messageId, subscription, headers);
                };
                onReceive(message);
            },
            // [RECEIPT Frame](http://stomp.github.com/stomp-specification-1.2.html#RECEIPT)
            "RECEIPT": function (frame) {
                var callback = _this._receiptWatchers[frame.headers["receipt-id"]];
                if (callback) {
                    callback(frame);
                    // Server will acknowledge only once, remove the callback
                    delete _this._receiptWatchers[frame.headers["receipt-id"]];
                }
                else {
                    _this.onUnhandledReceipt(frame);
                }
            },
            // [ERROR Frame](http://stomp.github.com/stomp-specification-1.2.html#ERROR)
            'ERROR': function (frame) {
                _this.onStompError(frame);
            }
        };
        // used to index subscribers
        this._counter = 0;
        // subscription callbacks indexed by subscriber's ID
        this._subscriptions = {};
        // receipt-watchers indexed by receipts-ids
        this._receiptWatchers = {};
        this._partialData = '';
        this._escapeHeaderValues = false;
        this._lastServerActivityTS = Date.now();
        this.configure(config);
    }
    Object.defineProperty(StompHandler.prototype, "connectedVersion", {
        get: function () {
            return this._connectedVersion;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(StompHandler.prototype, "connected", {
        get: function () {
            return this._connected;
        },
        enumerable: true,
        configurable: true
    });
    StompHandler.prototype.configure = function (conf) {
        // bulk assign all properties to this
        Object.assign(this, conf);
    };
    StompHandler.prototype.start = function () {
        var _this = this;
        var parser = new Parser(
        // On Frame
        function (rawFrame) {
            var frame = Frame.fromRawFrame(rawFrame, _this._escapeHeaderValues);
            _this.debug("<<< " + frame);
            var serverFrameHandler = _this._serverFrameHandlers[frame.command] || _this.onUnhandledFrame;
            serverFrameHandler(frame);
        }, 
        // On Incoming Ping
        function () {
            _this.debug("<<< PONG");
        });
        this._webSocket.onmessage = function (evt) {
            _this.debug('Received data');
            _this._lastServerActivityTS = Date.now();
            parser.parseChunk(evt.data);
        };
        this._webSocket.onclose = function (closeEvent) {
            _this.debug("Connection closed to " + _this._webSocket.url);
            _this.onWebSocketClose(closeEvent);
            _this._cleanUp();
        };
        this._webSocket.onopen = function () {
            _this.debug('Web Socket Opened...');
            _this.connectHeaders["accept-version"] = _this.stompVersions.supportedVersions();
            _this.connectHeaders["heart-beat"] = [_this.heartbeatOutgoing, _this.heartbeatIncoming].join(',');
            _this._transmit({ command: "CONNECT", headers: _this.connectHeaders });
        };
    };
    StompHandler.prototype._setupHeartbeat = function (headers) {
        var _this = this;
        if ((headers.version !== Versions.V1_1 && headers.version !== Versions.V1_2)) {
            return;
        }
        // heart-beat header received from the server looks like:
        //
        //     heart-beat: sx, sy
        var _a = (headers['heart-beat']).split(",").map(function (v) { return parseInt(v); }), serverOutgoing = _a[0], serverIncoming = _a[1];
        if ((this.heartbeatOutgoing !== 0) && (serverIncoming !== 0)) {
            var ttl = Math.max(this.heartbeatOutgoing, serverIncoming);
            this.debug("send PING every " + ttl + "ms");
            this._pinger = setInterval(function () {
                _this._webSocket.send(Byte.LF);
                _this.debug(">>> PING");
            }, ttl);
        }
        if ((this.heartbeatIncoming !== 0) && (serverOutgoing !== 0)) {
            var ttl_1 = Math.max(this.heartbeatIncoming, serverOutgoing);
            this.debug("check PONG every " + ttl_1 + "ms");
            this._ponger = setInterval(function () {
                var delta = Date.now() - _this._lastServerActivityTS;
                // We wait twice the TTL to be flexible on window's setInterval calls
                if (delta > (ttl_1 * 2)) {
                    _this.debug("did not receive server activity for the last " + delta + "ms");
                    _this._webSocket.close();
                }
            }, ttl_1);
        }
    };
    StompHandler.prototype._transmit = function (params) {
        var command = params.command, headers = params.headers, body = params.body, binaryBody = params.binaryBody, skipContentLengthHeader = params.skipContentLengthHeader;
        var frame = new Frame({
            command: command,
            headers: headers,
            body: body,
            binaryBody: binaryBody,
            escapeHeaderValues: this._escapeHeaderValues,
            skipContentLengthHeader: skipContentLengthHeader
        });
        this.debug(">>> " + frame);
        this._webSocket.send(frame.serialize());
        /* Do we need this?
            // if necessary, split the *STOMP* frame to send it on many smaller
            // *WebSocket* frames
            while (true) {
              if (out.length > this.maxWebSocketFrameSize) {
                this._webSocket.send(out.substring(0, this.maxWebSocketFrameSize));
                out = out.substring(this.maxWebSocketFrameSize);
                this.debug(`remaining = ${out.length}`);
              } else {
                this._webSocket.send(out);
                return;
              }
            }
        */
    };
    StompHandler.prototype.dispose = function () {
        var _this = this;
        if (this.connected) {
            try {
                if (!this.disconnectHeaders['receipt']) {
                    this.disconnectHeaders['receipt'] = "close-" + this._counter++;
                }
                this.watchForReceipt(this.disconnectHeaders['receipt'], function (frame) {
                    _this._webSocket.close();
                    _this._cleanUp();
                    _this.onDisconnect(frame);
                });
                this._transmit({ command: "DISCONNECT", headers: this.disconnectHeaders });
            }
            catch (error) {
                this.debug("Ignoring error during disconnect " + error);
            }
        }
        else {
            if (this._webSocket.readyState === WebSocket.CONNECTING || this._webSocket.readyState === WebSocket.OPEN) {
                this._webSocket.close();
            }
        }
    };
    StompHandler.prototype._cleanUp = function () {
        this._connected = false;
        if (this._pinger) {
            clearInterval(this._pinger);
        }
        if (this._ponger) {
            clearInterval(this._ponger);
        }
    };
    StompHandler.prototype.publish = function (params) {
        var destination = params.destination, headers = params.headers, body = params.body, binaryBody = params.binaryBody, skipContentLengthHeader = params.skipContentLengthHeader;
        headers = Object.assign({ destination: destination }, headers);
        this._transmit({
            command: "SEND",
            headers: headers,
            body: body,
            binaryBody: binaryBody,
            skipContentLengthHeader: skipContentLengthHeader
        });
    };
    StompHandler.prototype.watchForReceipt = function (receiptId, callback) {
        this._receiptWatchers[receiptId] = callback;
    };
    StompHandler.prototype.subscribe = function (destination, callback, headers) {
        if (headers === void 0) { headers = {}; }
        headers = Object.assign({}, headers);
        if (!headers.id) {
            headers.id = "sub-" + this._counter++;
        }
        headers.destination = destination;
        this._subscriptions[headers.id] = callback;
        this._transmit({ command: "SUBSCRIBE", headers: headers });
        var client = this;
        return {
            id: headers.id,
            unsubscribe: function (hdrs) {
                return client.unsubscribe(headers.id, hdrs);
            }
        };
    };
    StompHandler.prototype.unsubscribe = function (id, headers) {
        if (headers === void 0) { headers = {}; }
        headers = Object.assign({}, headers);
        delete this._subscriptions[id];
        headers.id = id;
        this._transmit({ command: "UNSUBSCRIBE", headers: headers });
    };
    StompHandler.prototype.begin = function (transactionId) {
        var txId = transactionId || ("tx-" + this._counter++);
        this._transmit({
            command: "BEGIN", headers: {
                transaction: txId
            }
        });
        var client = this;
        return {
            id: txId,
            commit: function () {
                client.commit(txId);
            },
            abort: function () {
                client.abort(txId);
            }
        };
    };
    StompHandler.prototype.commit = function (transactionId) {
        this._transmit({
            command: "COMMIT", headers: {
                transaction: transactionId
            }
        });
    };
    StompHandler.prototype.abort = function (transactionId) {
        this._transmit({
            command: "ABORT", headers: {
                transaction: transactionId
            }
        });
    };
    StompHandler.prototype.ack = function (messageId, subscriptionId, headers) {
        if (headers === void 0) { headers = {}; }
        headers = Object.assign({}, headers);
        if (this._connectedVersion === Versions.V1_2) {
            headers["id"] = messageId;
        }
        else {
            headers["message-id"] = messageId;
        }
        headers.subscription = subscriptionId;
        this._transmit({ command: "ACK", headers: headers });
    };
    StompHandler.prototype.nack = function (messageId, subscriptionId, headers) {
        if (headers === void 0) { headers = {}; }
        headers = Object.assign({}, headers);
        if (this._connectedVersion === Versions.V1_2) {
            headers["id"] = messageId;
        }
        else {
            headers["message-id"] = messageId;
        }
        headers.subscription = subscriptionId;
        return this._transmit({ command: "NACK", headers: headers });
    };
    return StompHandler;
}());
export { StompHandler };
//# sourceMappingURL=stomp-handler.js.map