// **STOMP Over Web Socket** is a JavaScript STOMP Client using
// [HTML5 Web Sockets API](http://www.w3.org/TR/websockets).
//
// * Copyright (C) 2010-2012 [Jeff Mesnil](http://jmesnil.net/)
// * Copyright (C) 2012 [FuseSource, Inc.](http://fusesource.com)
// * Copyright (C) 2017 [Deepak Kumar](https://www.kreatio.com)
//
// This library supports:
//
// * [STOMP 1.0](http://stomp.github.com/stomp-specification-1.0.html)
// * [STOMP 1.1](http://stomp.github.com/stomp-specification-1.1.html)
// * [STOMP 1.2](http://stomp.github.com/stomp-specification-1.2.html)
//
// The library is accessed through the `Stomp` object that is set on the `window`
// when running in a Web browser.

/*
   Stomp Over WebSocket http://www.jmesnil.net/stomp-websocket/doc/ | Apache License V2.0

   Copyright (C) 2010-2013 [Jeff Mesnil](http://jmesnil.net/)
   Copyright (C) 2012 [FuseSource, Inc.](http://fusesource.com)
   Copyright (C) 2017 [Deepak Kumar](https://www.kreatio.com)
*/

// @mixin
//
// @private
import {StompHeaders} from "./headers";
import {Client} from "./client";


// STOMP Client Class
//
// All STOMP protocol is exposed as methods of this class (`connect()`,

// Stomp exposes methods to instantiate Client.
//
// @mixin
export class Stomp {
  // @private
  public static VERSIONS = {
    V1_0: '1.0',
    V1_1: '1.1',
    V1_2: '1.2',

    // Versions of STOMP specifications supported
    supportedVersions: function() {
      return '1.2,1.1,1.0';
    }
  };

  public static WebSocketClass = null;

  // This method creates a WebSocket client that is connected to
  // the STOMP server located at the url.
  //
  // @example
  //        var url = "ws://localhost:61614/stomp";
  //        var client = Stomp.client(url);
  //
  // @param url [String]
  public static client (url, protocols) {
    // This is a hack to allow another implementation than the standard
    // HTML5 WebSocket class.
    //
    // It is possible to use another class by calling
    //
    //     Stomp.WebSocketClass = MozWebSocket
    //
    // *prior* to call `Stomp.client()`.
    //
    // This hack is deprecated and  `Stomp.over()` method should be used
    // instead.

    // See remarks on the function Stomp.over
    if (protocols == null) { protocols = ['v10.stomp', 'v11.stomp', 'v12.stomp']; }
    const ws_fn= function() {
      const klass = Stomp.WebSocketClass || WebSocket;
      return new klass(url, protocols);
    };

    return new Client(ws_fn);
  }

  // This method is an alternative to `Stomp.client()` to let the user
  // specify the WebSocket to use (either a standard HTML5 WebSocket or
  // a similar object).
  //
  // In order to support reconnection, the function Client._connect should be callable more than once. While reconnecting
  // a new instance of underlying transport (TCP Socket, WebSocket or SockJS) will be needed. So, this function
  // alternatively allows passing a function that should return a new instance of the underlying socket.
  //
  // @example
  //         var client = Stomp.over(function(){
  //           return new WebSocket('ws://localhost:15674/ws')
  //         });
  //
  // @param ws [WebSocket|function()] a WebSocket like Object or a function returning a WebObject or similar Object
  //
  // @note If you need auto reconnect feature you must pass a function that returns a WebSocket or similar Object
  public static over (ws) {
    const ws_fn = typeof(ws) === "function" ? ws : () => ws;

    return new Client(ws_fn);
  }

  public static setInterval(interval, f) {
    setInterval(f, interval);
  }

  public static clearInterval(id) {
    clearInterval(id)
  };
}