'use strict'

/**
 * Testing dependencies
 */
const should = require('chai').should
const sinon = require('sinon')
const mqtt = require('../')
const Store = require('./../lib/store')
const assert = require('chai').assert
const ports = require('./helpers/port_list')
const serverBuilder = require('./server_helpers_for_client_tests').serverBuilder
const fs = require('fs')
const levelStore = require('mqtt-level-store')

/**
  * These tests try to be consistent with names for servers (brokers) and clients,
  * but it can be confusing. To make it easier, here is a handy translation
  * chart:
  *
  * name           | meaning
  * ---------------|--------
  * client         | The MQTT.js client object being tested. A new instance is created for each test (by calling the `connect` function.)
  * server         | A mock broker that you can control. The same server instance is used for all tests, so only use this if you plan to clean up when you're done.
  * serverBuilder  | A factory that can make mock test servers (MQTT brokers). Useful if you need to do things that you can't (or don't want to) clean up after your test is done.
  * server2        | The name used for mock brokers that are created for an individual test and then destroyed.
  * serverClient   | An socket on the mock broker. This gets created when your client connects and gets collected when you're done with it.
  *
  * Also worth noting:
  *
  * `serverClient.disconnect()` does not disconnect that socket. Instead, it sends an MQTT disconnect packet.
  * If you want to disconnect the socket from the broker side, you probably want to use `serverClient.destroy()`
  * or `serverClient.stream.destroy()`.
  *
  */

module.exports = function (server, config) {
  const version = config.protocolVersion || 4

  function connect (opts) {
    opts = { ...config, ...opts }
    return mqtt.connect(opts)
  }

  describe('closing', function () {
    it('should emit close if stream closes', function (done) {
      const client = connect()

      client.once('connect', function () {
        client.stream.end()
      })
      client.once('close', function () {
        client.end((err) => done(err))
      })
    })

    it('should mark the client as disconnected', function (done) {
      const client = connect()

      client.once('close', function () {
        client.end((err) => {
          if (!client.connected) {
            done(err)
          } else {
            done(new Error('Not marked as disconnected'))
          }
        })
        assert.isFalse(client.connected)
      })
      client.once('connect', function () {
        client.stream.end()
      })
    })

    it('should stop ping timer if stream closes', function (done) {
      const client = connect()

      client.once('close', function () {
        assert.notExists(client.pingTimer)
        client.end(true, (err) => done(err))
      })

      client.once('connect', function () {
        assert.exists(client.pingTimer)
        client.stream.end()
      })
    })

    it('should emit close after end called', function (done) {
      const client = connect()

      client.once('close', function () {
        done()
      })

      client.once('connect', function () {
        client.end()
      })
    })

    it('should emit end after end called and client must be disconnected', function (done) {
      const client = connect()

      client.once('end', function () {
        if (client.disconnected) {
          return done()
        }
        done(new Error('client must be disconnected'))
      })

      client.once('connect', function () {
        client.end()
      })
    })

    it('should pass store close error to end callback but not to end listeners (incomingStore)', function (done) {
      const store = new Store()
      const client = connect({ incomingStore: store })

      store.close = function (cb) {
        cb(new Error('test'))
      }
      client.once('end', function () {
        if (arguments.length === 0) {
          return
        }
        throw new Error('no argument should be passed to event')
      })

      client.once('connect', function () {
        client.end(function (testError) {
          if (testError && testError.message === 'test') {
            return done()
          }
          throw new Error('bad argument passed to callback')
        })
      })
    })

    it('should pass store close error to end callback but not to end listeners (outgoingStore)', function (done) {
      const store = new Store()
      const client = connect({ outgoingStore: store })

      store.close = function (cb) {
        cb(new Error('test'))
      }
      client.once('end', function () {
        if (arguments.length === 0) {
          return
        }
        throw new Error('no argument should be passed to event')
      })

      client.once('connect', function () {
        client.end(function (testError) {
          if (testError && testError.message === 'test') {
            return done()
          }
          throw new Error('bad argument passed to callback')
        })
      })
    })

    it('should return `this` if end called twice', function (done) {
      const client = connect()

      client.once('connect', function () {
        client.end()
        const value = client.end()
        if (value === client) {
          done()
        } else {
          done(new Error('Not returning client.'))
        }
      })
    })

    it('should emit end only on first client end', function (done) {
      const client = connect()

      client.once('end', function () {
        const timeout = setTimeout(done.bind(null), 200)
        client.once('end', function () {
          clearTimeout(timeout)
          done(new Error('end was emitted twice'))
        })
        client.end()
      })

      client.once('connect', client.end.bind(client))
    })

    it('should stop ping timer after end called', function (done) {
      const client = connect()

      client.once('connect', function () {
        assert.exists(client.pingTimer)
        client.end((err) => {
          assert.notExists(client.pingTimer)
          done(err)
        })
      })
    })

    it('should be able to end even on a failed connection', function (done) {
      const client = connect({ host: 'this_hostname_should_not_exist' })

      const timeout = setTimeout(function () {
        done(new Error('Failed to end a disconnected client'))
      }, 500)

      setTimeout(function () {
        client.end(function (err) {
          clearTimeout(timeout)
          done(err)
        })
      }, 200)
    })

    it('should emit end even on a failed connection', function (done) {
      const client = connect({ host: 'this_hostname_should_not_exist' })

      const timeout = setTimeout(function () {
        done(new Error('Disconnected client has failed to emit end'))
      }, 500)

      client.once('end', function () {
        clearTimeout(timeout)
        done()
      })

      // after 200ms manually invoke client.end
      setTimeout(() => {
        const boundEnd = client.end.bind(client)
        boundEnd()
      }, 200)
    })

    it.skip('should emit end only once for a reconnecting client', function (done) {
      // I want to fix this test, but it will take signficant work, so I am marking it as a skipping test right now.
      // Reason for it is that there are overlaps in the reconnectTimer and connectTimer. In the PR for this code
      // there will be gists showing the difference between a successful test here and a failed test. For now we
      // will add the retries syntax because of the flakiness.
      const client = connect({ host: 'this_hostname_should_not_exist', connectTimeout: 10, reconnectPeriod: 20 })
      setTimeout(done.bind(null), 1000)
      const endCallback = function () {
        assert.strictEqual(spy.callCount, 1, 'end was emitted more than once for reconnecting client')
      }

      const spy = sinon.spy(endCallback)
      client.on('end', spy)
      setTimeout(() => {
        client.end.bind(client)
        client.end()
      }, 300)
    })
  })

  describe('connecting', function () {
    it('should connect to the broker', function (done) {
      const client = connect()
      client.on('error', done)

      server.once('client', function () {
        client.end((err) => done(err))
      })
    })

    it('should send a default client id', function (done) {
      const client = connect()
      client.on('error', done)

      server.once('client', function (serverClient) {
        serverClient.once('connect', function (packet) {
          assert.include(packet.clientId, 'mqttjs')
          client.end((err) => done(err))
        })
      })
    })

    it('should send be clean by default', function (done) {
      const client = connect()
      client.on('error', done)

      server.once('client', function (serverClient) {
        serverClient.once('connect', function (packet) {
          assert.strictEqual(packet.clean, true)
          done()
        })
      })
    })

    it('should connect with the given client id', function (done) {
      const client = connect({ clientId: 'testclient' })
      client.on('error', function (err) {
        throw err
      })

      server.once('client', function (serverClient) {
        serverClient.once('connect', function (packet) {
          assert.include(packet.clientId, 'testclient')
          client.end((err) => done(err))
        })
      })
    })

    it('should connect with the client id and unclean state', function (done) {
      const client = connect({ clientId: 'testclient', clean: false })
      client.on('error', function (err) {
        throw err
      })

      server.once('client', function (serverClient) {
        serverClient.once('connect', function (packet) {
          assert.include(packet.clientId, 'testclient')
          assert.isFalse(packet.clean)
          client.end(false, (err) => done(err))
        })
      })
    })

    it('should require a clientId with clean=false', function (done) {
      try {
        const client = connect({ clean: false })
        client.on('error', function (err) {
          done(err)
        })
      } catch (err) {
        assert.strictEqual(err.message, 'Missing clientId for unclean clients')
        done()
      }
    })

    it('should default to localhost', function (done) {
      const client = connect({ clientId: 'testclient' })
      client.on('error', function (err) {
        throw err
      })

      server.once('client', function (serverClient) {
        serverClient.once('connect', function (packet) {
          assert.include(packet.clientId, 'testclient')
          done()
        })
      })
    })

    it('should emit connect', function (done) {
      const client = connect()
      client.once('connect', function () {
        client.end(true, (err) => done(err))
      })
      client.once('error', done)
    })

    it('should provide connack packet with connect event', function (done) {
      const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
      server.once('client', function (serverClient) {
        connack.sessionPresent = true
        serverClient.connack(connack)
        server.once('client', function (serverClient) {
          connack.sessionPresent = false
          serverClient.connack(connack)
        })
      })

      const client = connect()
      client.once('connect', function (packet) {
        assert.strictEqual(packet.sessionPresent, true)
        client.once('connect', function (packet) {
          assert.strictEqual(packet.sessionPresent, false)
          client.end((err) => done(err))
        })
      })
    })

    it('should mark the client as connected', function (done) {
      const client = connect()
      client.once('connect', function () {
        assert.isTrue(client.connected)
        client.end((err) => done(err))
      })
    })

    it('should emit error on invalid clientId', function (done) {
      const client = connect({ clientId: 'invalid' })
      client.once('connect', function () {
        done(new Error('Should not emit connect'))
      })
      client.once('error', function (error) {
        const value = version === 5 ? 128 : 2
        assert.strictEqual(error.code, value) // code for clientID identifer rejected
        client.end((err) => done(err))
      })
    })

    it('should emit error event if the socket refuses the connection', function (done) {
      // fake a port
      const client = connect({ port: 4557 })

      client.on('error', function (e) {
        assert.equal(e.code, 'ECONNREFUSED')
        client.end((err) => done(err))
      })
    })

    it('should have different client ids', function (done) {
      // bug identified in this test: the client.end callback is invoked twice, once when the `end`
      // method completes closing the stores and invokes the callback, and another time when the
      // stream is closed. When the stream is closed, for some reason the closeStores method is called
      // a second time.
      const client1 = connect()
      const client2 = connect()

      assert.notStrictEqual(client1.options.clientId, client2.options.clientId)
      client1.end(true, () => {
        client2.end(true, () => {
          done()
        })
      })
    })
  })

  describe('handling offline states', function () {
    it('should emit offline event once when the client transitions from connected states to disconnected ones', function (done) {
      const client = connect({ reconnectPeriod: 20 })

      client.on('connect', function () {
        this.stream.end()
      })

      client.on('offline', function () {
        client.end(true, done)
      })
    })

    it('should emit offline event once when the client (at first) can NOT connect to servers', function (done) {
      // fake a port
      const client = connect({ reconnectPeriod: 20, port: 4557 })

      client.on('error', function () { })

      client.on('offline', function () {
        client.end(true, done)
      })
    })
  })

  describe('topic validations when subscribing', function () {
    it('should be ok for well-formated topics', function (done) {
      const client = connect()
      client.subscribe(
        [
          '+', '+/event', 'event/+', '#', 'event/#', 'system/event/+',
          'system/+/event', 'system/registry/event/#', 'system/+/event/#',
          'system/registry/event/new_device', 'system/+/+/new_device'
        ],
        function (err) {
          client.end(function () {
            if (err) {
              return done(new Error(err))
            }
            done()
          })
        }
      )
    })

    it('should return an error (via callbacks) for topic #/event', function (done) {
      const client = connect()
      client.subscribe(['#/event', 'event#', 'event+'], function (err) {
        client.end(false, function () {
          if (err) {
            return done()
          }
          done(new Error('Validations do NOT work'))
        })
      })
    })

    it('should return an empty array for duplicate subs', function (done) {
      const client = connect()
      client.subscribe('event', function (err, granted1) {
        if (err) {
          return done(err)
        }
        client.subscribe('event', function (err, granted2) {
          if (err) {
            return done(err)
          }
          assert.isArray(granted2)
          assert.isEmpty(granted2)
          done()
        })
      })
    })

    it('should return an error (via callbacks) for topic #/event', function (done) {
      const client = connect()
      client.subscribe('#/event', function (err) {
        client.end(function () {
          if (err) {
            return done()
          }
          done(new Error('Validations do NOT work'))
        })
      })
    })

    it('should return an error (via callbacks) for topic event#', function (done) {
      const client = connect()
      client.subscribe('event#', function (err) {
        client.end(function () {
          if (err) {
            return done()
          }
          done(new Error('Validations do NOT work'))
        })
      })
    })

    it('should return an error (via callbacks) for topic system/#/event', function (done) {
      const client = connect()
      client.subscribe('system/#/event', function (err) {
        client.end(function () {
          if (err) {
            return done()
          }
          done(new Error('Validations do NOT work'))
        })
      })
    })

    it('should return an error (via callbacks) for empty topic list', function (done) {
      const client = connect()
      client.subscribe([], (subErr) => {
        client.end((endErr) => {
          if (subErr) {
            return done(endErr)
          } else {
            done(new Error('Validations do NOT work'))
          }
        })
      })
    })

    it('should return an error (via callbacks) for topic system/+/#/event', function (done) {
      const client = connect()
      client.subscribe('system/+/#/event', function (subErr) {
        client.end(true, (endErr) => {
          if (subErr) {
            return done(endErr)
          } else {
            done(new Error('Validations do NOT work'))
          }
        })
      })
    })
  })

  describe('offline messages', function () {
    it('should queue message until connected', function (done) {
      const client = connect()

      client.publish('test', 'test')
      client.subscribe('test')
      client.unsubscribe('test')
      assert.strictEqual(client.queue.length, 3)

      client.once('connect', function () {
        assert.strictEqual(client.queue.length, 0)
        setTimeout(function () {
          client.end(true, done)
        }, 10)
      })
    })

    it('should not queue qos 0 messages if queueQoSZero is false', function (done) {
      const client = connect({ queueQoSZero: false })

      client.publish('test', 'test', { qos: 0 })
      assert.strictEqual(client.queue.length, 0)
      client.on('connect', function () {
        setTimeout(function () {
          client.end(true, done)
        }, 10)
      })
    })

    it('should queue qos != 0 messages', function (done) {
      const client = connect({ queueQoSZero: false })

      client.publish('test', 'test', { qos: 1 })
      client.publish('test', 'test', { qos: 2 })
      client.subscribe('test')
      client.unsubscribe('test')
      assert.strictEqual(client.queue.length, 2)
      client.on('connect', function () {
        setTimeout(function () {
          client.end(true, done)
        }, 10)
      })
    })

    it('should not interrupt messages', function (done) {
      let client = null
      let publishCount = 0
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function () {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (packet.qos !== 0) {
            serverClient.puback({ messageId: packet.messageId })
          }
          switch (publishCount++) {
            case 0:
              assert.strictEqual(packet.payload.toString(), 'payload1')
              break
            case 1:
              assert.strictEqual(packet.payload.toString(), 'payload2')
              break
            case 2:
              assert.strictEqual(packet.payload.toString(), 'payload3')
              break
            case 3:
              assert.strictEqual(packet.payload.toString(), 'payload4')
              client.end((err1) => {
                server2.close((err2) => done(err1 || err2))
              })
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore,
          queueQoSZero: true
        })
        client.on('packetreceive', function (packet) {
          if (packet.cmd === 'connack') {
            setImmediate(
              function () {
                client.publish('test', 'payload3', { qos: 1 })
                client.publish('test', 'payload4', { qos: 0 })
              }
            )
          }
        })
        client.publish('test', 'payload1', { qos: 2 })
        client.publish('test', 'payload2', { qos: 2 })
      })
    })

    it('should not overtake the messages stored in the level-db-store', function (done) {
      const storePath = fs.mkdtempSync('test-store_')
      const store = levelStore(storePath)
      let client = null
      const incomingStore = store.incoming
      const outgoingStore = store.outgoing
      let publishCount = 0

      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function () {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (packet.qos !== 0) {
            serverClient.puback({ messageId: packet.messageId })
          }

          switch (publishCount++) {
            case 0:
              assert.strictEqual(packet.payload.toString(), 'payload1')
              break
            case 1:
              assert.strictEqual(packet.payload.toString(), 'payload2')
              break
            case 2:
              assert.strictEqual(packet.payload.toString(), 'payload3')

              server2.close((err) => {
                fs.rmSync(storePath, { recursive: true })
                done(err)
              })
              break
          }
        })
      })

      const clientOptions = {
        port: ports.PORTAND72,
        host: 'localhost',
        clean: false,
        clientId: 'cid1',
        reconnectPeriod: 0,
        incomingStore,
        outgoingStore,
        queueQoSZero: true
      }

      server2.listen(ports.PORTAND72, function () {
        client = connect(clientOptions)

        client.once('close', function () {
          client.once('connect', function () {
            client.publish('test', 'payload2', { qos: 1 })
            client.publish('test', 'payload3', { qos: 1 }, function () {
              client.end(false)
            })
          })
          // reconecting
          client.reconnect(clientOptions)
        })

        // publish and close
        client.once('connect', function () {
          client.publish('test', 'payload1', {
            qos: 1,
            cbStorePut: function () {
              client.end(true)
            }
          })
        })
      })
    })

    it('should call cb if an outgoing QoS 0 message is not sent', function (done) {
      const client = connect({ queueQoSZero: false })
      let called = false

      client.publish('test', 'test', { qos: 0 }, function () {
        called = true
      })

      client.on('connect', function () {
        assert.isTrue(called)
        setTimeout(function () {
          client.end(true, done)
        }, 10)
      })
    })

    it('should delay ending up until all inflight messages are delivered', function (done) {
      const client = connect()
      let subscribeCalled = false

      client.on('connect', function () {
        client.subscribe('test', function () {
          subscribeCalled = true
        })
        client.publish('test', 'test', function () {
          client.end(false, function () {
            assert.strictEqual(subscribeCalled, true)
            done()
          })
        })
      })
    })

    it('wait QoS 1 publish messages', function (done) {
      const client = connect()
      let messageReceived = false

      client.on('connect', function () {
        client.subscribe('test')
        client.publish('test', 'test', { qos: 1 }, function () {
          client.end(false, function () {
            assert.strictEqual(messageReceived, true)
            done()
          })
        })
        client.on('message', function () {
          messageReceived = true
        })
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.on('publish', function (packet) {
            serverClient.publish(packet)
          })
        })
      })
    })

    it('does not wait acks when force-closing', function (done) {
      // non-running broker
      const client = connect('mqtt://localhost:8993')
      client.publish('test', 'test', { qos: 1 })
      client.end(true, done)
    })

    it('should call cb if store.put fails', function (done) {
      const store = new Store()
      store.put = function (packet, cb) {
        process.nextTick(cb, new Error('oops there is an error'))
      }
      const client = connect({ incomingStore: store, outgoingStore: store })
      client.publish('test', 'test', { qos: 2 }, function (err) {
        if (err) {
          client.end(true, done)
        }
      })
    })
  })

  describe('publishing', function () {
    it('should publish a message (offline)', function (done) {
      const client = connect()
      const payload = 'test'
      const topic = 'test'
      // don't wait on connect to send publish
      client.publish(topic, payload)

      server.on('client', onClient)

      function onClient (serverClient) {
        serverClient.once('connect', function () {
          server.removeListener('client', onClient)
        })

        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, 0)
          assert.strictEqual(packet.retain, false)
          client.end(true, done)
        })
      }
    })

    it('should publish a message (online)', function (done) {
      const client = connect()
      const payload = 'test'
      const topic = 'test'
      // block on connect before sending publish
      client.on('connect', function () {
        client.publish(topic, payload)
      })

      server.on('client', onClient)

      function onClient (serverClient) {
        serverClient.once('connect', function () {
          server.removeListener('client', onClient)
        })

        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, 0)
          assert.strictEqual(packet.retain, false)
          client.end(true, done)
        })
      }
    })

    it('should publish a message (retain, offline)', function (done) {
      const client = connect({ queueQoSZero: true })
      const payload = 'test'
      const topic = 'test'
      let called = false

      client.publish(topic, payload, { retain: true }, function () {
        called = true
      })

      server.once('client', function (serverClient) {
        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, 0)
          assert.strictEqual(packet.retain, true)
          assert.strictEqual(called, true)
          client.end(true, done)
        })
      })
    })

    it('should emit a packetsend event', function (done) {
      const client = connect()
      const payload = 'test_payload'
      const topic = 'testTopic'

      client.on('packetsend', function (packet) {
        if (packet.cmd === 'publish') {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, 0)
          assert.strictEqual(packet.retain, false)
          client.end(true, done)
        } else {
          done(new Error('packet.cmd was not publish!'))
        }
      })

      client.publish(topic, payload)
    })

    it('should accept options', function (done) {
      const client = connect()
      const payload = 'test'
      const topic = 'test'
      const opts = {
        retain: true,
        qos: 1
      }
      let received = false

      client.once('connect', function () {
        client.publish(topic, payload, opts, function (err) {
          assert(received)
          client.end(function () {
            done(err)
          })
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, opts.qos, 'incorrect qos')
          assert.strictEqual(packet.retain, opts.retain, 'incorrect ret')
          assert.strictEqual(packet.dup, false, 'incorrect dup')
          received = true
        })
      })
    })

    it('should publish with the default options for an empty parameter', function (done) {
      const client = connect()
      const payload = 'test'
      const topic = 'test'
      const defaultOpts = { qos: 0, retain: false, dup: false }

      client.once('connect', function () {
        client.publish(topic, payload, {})
      })

      server.once('client', function (serverClient) {
        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, defaultOpts.qos, 'incorrect qos')
          assert.strictEqual(packet.retain, defaultOpts.retain, 'incorrect ret')
          assert.strictEqual(packet.dup, defaultOpts.dup, 'incorrect dup')
          client.end(true, done)
        })
      })
    })

    it('should mark a message as duplicate when "dup" option is set', function (done) {
      const client = connect()
      const payload = 'duplicated-test'
      const topic = 'test'
      const opts = {
        retain: true,
        qos: 1,
        dup: true
      }
      let received = false

      client.once('connect', function () {
        client.publish(topic, payload, opts, function (err) {
          assert(received)
          client.end(function () {
            done(err)
          })
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('publish', function (packet) {
          assert.strictEqual(packet.topic, topic)
          assert.strictEqual(packet.payload.toString(), payload)
          assert.strictEqual(packet.qos, opts.qos, 'incorrect qos')
          assert.strictEqual(packet.retain, opts.retain, 'incorrect ret')
          assert.strictEqual(packet.dup, opts.dup, 'incorrect dup')
          received = true
        })
      })
    })

    it('should fire a callback (qos 0)', function (done) {
      const client = connect()

      client.once('connect', function () {
        client.publish('a', 'b', function () {
          client.end((err) => done(err))
        })
      })
    })

    it('should fire a callback (qos 1)', function (done) {
      const client = connect()
      const opts = { qos: 1 }

      client.once('connect', function () {
        client.publish('a', 'b', opts, function () {
          client.end((err) => done(err))
        })
      })
    })

    it('should fire a callback (qos 1) on error', function (done) {
      // 145 = Packet Identifier in use
      const pubackReasonCode = 145
      const pubOpts = { qos: 1 }
      let client = null

      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function () {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (packet.qos === 1) {
            if (version === 5) {
              serverClient.puback({
                messageId: packet.messageId,
                reasonCode: pubackReasonCode
              })
            } else {
              serverClient.puback({ messageId: packet.messageId })
            }
          }
        })
      })

      server2.listen(ports.PORTAND72, function () {
        client = connect({
          port: ports.PORTAND72,
          host: 'localhost',
          clean: true,
          clientId: 'cid1',
          reconnectPeriod: 0
        })

        client.once('connect', function () {
          client.publish('a', 'b', pubOpts, function (err) {
            if (version === 5) {
              assert.strictEqual(err.code, pubackReasonCode)
            } else {
              assert.ifError(err)
            }
            setImmediate(function () {
              client.end(() => {
                server2.close(done())
              })
            })
          })
        })
      })
    })

    it('should fire a callback (qos 2)', function (done) {
      const client = connect()
      const opts = { qos: 2 }

      client.once('connect', function () {
        client.publish('a', 'b', opts, function () {
          client.end((err) => done(err))
        })
      })
    })

    it('should fire a callback (qos 2) on error', function (done) {
      // 145 = Packet Identifier in use
      const pubrecReasonCode = 145
      const pubOpts = { qos: 2 }
      let client = null

      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function () {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (packet.qos === 2) {
            if (version === 5) {
              serverClient.pubrec({
                messageId: packet.messageId,
                reasonCode: pubrecReasonCode
              })
            } else {
              serverClient.pubrec({ messageId: packet.messageId })
            }
          }
        })
        serverClient.on('pubrel', function (packet) {
          if (!serverClient.writable) return false
          serverClient.pubcomp(packet)
        })
      })

      server2.listen(ports.PORTAND103, function () {
        client = connect({
          port: ports.PORTAND103,
          host: 'localhost',
          clean: true,
          clientId: 'cid1',
          reconnectPeriod: 0
        })

        client.once('connect', function () {
          client.publish('a', 'b', pubOpts, function (err) {
            if (version === 5) {
              assert.strictEqual(err.code, pubrecReasonCode)
            } else {
              assert.ifError(err)
            }
            setImmediate(function () {
              client.end(true, () => {
                server2.close(done())
              })
            })
          })
        })
      })
    })

    it('should support UTF-8 characters in topic', function (done) {
      const client = connect()

      client.once('connect', function () {
        client.publish('中国', 'hello', function () {
          client.end((err) => done(err))
        })
      })
    })

    it('should support UTF-8 characters in payload', function (done) {
      const client = connect()

      client.once('connect', function () {
        client.publish('hello', '中国', function () {
          client.end((err) => done(err))
        })
      })
    })

    it('should publish 10 QoS 2 and receive them', function (done) {
      const client = connect()
      let countSent = 0
      let countReceived = 0

      function publishNext () {
        client.publish('test', 'test', { qos: 2 }, function (err) {
          assert.ifError(err)
          countSent++
        })
      }

      client.on('connect', function () {
        client.subscribe('test', function (err) {
          assert.ifError(err)
          publishNext()
        })
      })

      client.on('message', function () {
        countReceived++
        if (countSent >= 10 && countReceived >= 10) {
          client.end(done)
        } else {
          publishNext()
        }
      })

      server.once('client', function (serverClient) {
        serverClient.on('offline', function () {
          client.end()
          done('error went offline... didnt see this happen')
        })

        serverClient.on('subscribe', function () {
          serverClient.on('publish', function (packet) {
            serverClient.publish(packet)
          })
        })
      })
    })

    function testQosHandleMessage (qos, done) {
      const client = connect()

      let messageEventCount = 0
      let handleMessageCount = 0

      client.handleMessage = function (packet, callback) {
        setTimeout(function () {
          handleMessageCount++
          // next message event should not emit until handleMessage completes
          assert.strictEqual(handleMessageCount, messageEventCount)
          if (handleMessageCount === 10) {
            setTimeout(function () {
              client.end(true, done)
            })
          }
          callback()
        }, 100)
      }

      client.on('message', function (topic, message, packet) {
        messageEventCount++
      })

      client.on('connect', function () {
        client.subscribe('test')
      })

      server.once('client', function (serverClient) {
        serverClient.on('offline', function () {
          client.end(true, function () {
            done('error went offline... didnt see this happen')
          })
        })

        serverClient.on('subscribe', function () {
          for (let i = 0; i < 10; i++) {
            serverClient.publish({
              messageId: i,
              topic: 'test',
              payload: 'test' + i,
              qos
            })
          }
        })
      })
    }

    const qosTests = [0, 1, 2]
    qosTests.forEach(function (QoS) {
      it('should publish 10 QoS ' + QoS + 'and receive them only when `handleMessage` finishes', function (done) {
        testQosHandleMessage(QoS, done)
      })
    })

    it('should not send a `puback` if the execution of `handleMessage` fails for messages with QoS `1`', function (done) {
      const client = connect()

      client.handleMessage = function (packet, callback) {
        callback(new Error('Error thrown by the application'))
      }

      client._sendPacket = sinon.spy()

      client._handlePublish({
        messageId: Math.floor(65535 * Math.random()),
        topic: 'test',
        payload: 'test',
        qos: 1
      }, function (err) {
        assert.exists(err)
      })

      assert.strictEqual(client._sendPacket.callCount, 0)
      client.end()
      client.on('connect', function () { done() })
    })

    it('should silently ignore errors thrown by `handleMessage` and return when no callback is passed ' +
      'into `handlePublish` method', function (done) {
      const client = connect()

      client.handleMessage = function (packet, callback) {
        callback(new Error('Error thrown by the application'))
      }

      try {
        client._handlePublish({
          messageId: Math.floor(65535 * Math.random()),
          topic: 'test',
          payload: 'test',
          qos: 1
        })
        client.end(true, done)
      } catch (err) {
        client.end(true, () => { done(err) })
      }
    })

    it('should handle error with async incoming store in QoS 1 `handlePublish` method', function (done) {
      class AsyncStore {
        put (packet, cb) {
          process.nextTick(function () {
            cb(null, 'Error')
          })
        }

        close (cb) {
          cb()
        }
      }

      const store = new AsyncStore()
      const client = connect({ incomingStore: store })

      client._handlePublish({
        messageId: 1,
        topic: 'test',
        payload: 'test',
        qos: 1
      }, function () {
        client.end((err) => done(err))
      })
    })

    it('should handle error with async incoming store in QoS 2 `handlePublish` method', function (done) {
      class AsyncStore {
        put (packet, cb) {
          process.nextTick(function () {
            cb(null, 'Error')
          })
        }

        del (packet, cb) {
          process.nextTick(function () {
            cb(new Error('Error'))
          })
        }

        get (packet, cb) {
          process.nextTick(function () {
            cb(null, { cmd: 'publish' })
          })
        }

        close (cb) {
          cb()
        }
      }

      const store = new AsyncStore()
      const client = connect({ incomingStore: store })

      client._handlePublish({
        messageId: 1,
        topic: 'test',
        payload: 'test',
        qos: 2
      }, function () {
        client.end((err) => done(err))
      })
    })

    it('should handle error with async incoming store in QoS 2 `handlePubrel` method', function (done) {
      class AsyncStore {
        put (packet, cb) {
          process.nextTick(function () {
            cb(null, 'Error')
          })
        }

        del (packet, cb) {
          process.nextTick(function () {
            cb(new Error('Error'))
          })
        }

        get (packet, cb) {
          process.nextTick(function () {
            cb(null, { cmd: 'publish' })
          })
        }

        close (cb) {
          cb()
        }
      }

      const store = new AsyncStore()
      const client = connect({ incomingStore: store })

      client._handlePubrel({
        messageId: 1,
        qos: 2
      }, function () {
        client.end(true, (err) => done(err))
      })
    })

    it('should handle success with async incoming store in QoS 2 `handlePubrel` method', function (done) {
      let delComplete = false
      class AsyncStore {
        put (packet, cb) {
          process.nextTick(function () {
            cb(null, 'Error')
          })
        }

        del (packet, cb) {
          process.nextTick(function () {
            delComplete = true
            cb(null)
          })
        }

        get (packet, cb) {
          process.nextTick(function () {
            cb(null, { cmd: 'publish' })
          })
        }

        close (cb) {
          cb()
        }
      }

      const store = new AsyncStore()
      const client = connect({ incomingStore: store })

      client._handlePubrel({
        messageId: 1,
        qos: 2
      }, function () {
        assert.isTrue(delComplete)
        client.end(true, done)
      })
    })

    it('should not send a `pubcomp` if the execution of `handleMessage` fails for messages with QoS `2`', function (done) {
      const store = new Store()
      const client = connect({ incomingStore: store })

      const messageId = Math.floor(65535 * Math.random())
      const topic = 'testTopic'
      const payload = 'testPayload'
      const qos = 2

      client.handleMessage = function (packet, callback) {
        callback(new Error('Error thrown by the application'))
      }

      client.once('connect', function () {
        client.subscribe(topic, { qos: 2 })

        store.put({
          messageId,
          topic,
          payload,
          qos,
          cmd: 'publish'
        }, function () {
          // cleans up the client
          client._sendPacket = sinon.spy()
          client._handlePubrel({ cmd: 'pubrel', messageId }, function (err) {
            assert.exists(err)
            assert.strictEqual(client._sendPacket.callCount, 0)
            client.end(true, done)
          })
        })
      })
    })

    it('should silently ignore errors thrown by `handleMessage` and return when no callback is passed ' +
      'into `handlePubrel` method', function (done) {
      const store = new Store()
      const client = connect({ incomingStore: store })

      const messageId = Math.floor(65535 * Math.random())
      const topic = 'test'
      const payload = 'test'
      const qos = 2

      client.handleMessage = function (packet, callback) {
        callback(new Error('Error thrown by the application'))
      }

      client.once('connect', function () {
        client.subscribe(topic, { qos: 2 })

        store.put({
          messageId,
          topic,
          payload,
          qos,
          cmd: 'publish'
        }, function () {
          try {
            client._handlePubrel({ cmd: 'pubrel', messageId })
            client.end(true, done)
          } catch (err) {
            client.end(true, () => { done(err) })
          }
        })
      })
    })

    it('should keep message order', function (done) {
      let publishCount = 0
      let reconnect = false
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        // errors are not interesting for this test
        // but they might happen on some platforms
        serverClient.on('error', function () { })

        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          serverClient.puback({ messageId: packet.messageId })
          if (reconnect) {
            switch (publishCount++) {
              case 0:
                assert.strictEqual(packet.payload.toString(), 'payload1')
                break
              case 1:
                assert.strictEqual(packet.payload.toString(), 'payload2')
                break
              case 2:
                assert.strictEqual(packet.payload.toString(), 'payload3')
                client.end((err1) => {
                  server2.close((err2) => done(err1 || err2))
                })
                break
            }
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.on('connect', function () {
          if (!reconnect) {
            client.publish('topic', 'payload1', { qos: 1 })
            client.publish('topic', 'payload2', { qos: 1 })
            client.end(true)
          } else {
            client.publish('topic', 'payload3', { qos: 1 })
          }
        })
        client.on('close', function () {
          if (!reconnect) {
            client.reconnect({
              clean: false,
              incomingStore,
              outgoingStore
            })
            reconnect = true
          }
        })
      })
    })

    function testCallbackStorePutByQoS (qos, clean, expected, done) {
      const client = connect({
        clean,
        clientId: 'testId'
      })

      const callbacks = []

      function cbStorePut () {
        callbacks.push('storeput')
      }

      client.on('connect', function () {
        client.publish('test', 'test', { qos, cbStorePut }, function (err) {
          if (err) done(err)
          callbacks.push('publish')
          assert.deepEqual(callbacks, expected)
          client.end(true, done)
        })
      })
    }

    const callbackStorePutByQoSParameters = [
      { args: [0, true], expected: ['publish'] },
      { args: [0, false], expected: ['publish'] },
      { args: [1, true], expected: ['storeput', 'publish'] },
      { args: [1, false], expected: ['storeput', 'publish'] },
      { args: [2, true], expected: ['storeput', 'publish'] },
      { args: [2, false], expected: ['storeput', 'publish'] }
    ]

    callbackStorePutByQoSParameters.forEach(function (test) {
      if (test.args[0] === 0) { // QoS 0
        it('should not call cbStorePut when publishing message with QoS `' + test.args[0] + '` and clean `' + test.args[1] + '`', function (done) {
          testCallbackStorePutByQoS(test.args[0], test.args[1], test.expected, done)
        })
      } else { // QoS 1 and 2
        it('should call cbStorePut before publish completes when publishing message with QoS `' + test.args[0] + '` and clean `' + test.args[1] + '`', function (done) {
          testCallbackStorePutByQoS(test.args[0], test.args[1], test.expected, done)
        })
      }
    })
  })

  describe('unsubscribing', function () {
    it('should send an unsubscribe packet (offline)', function (done) {
      const client = connect()
      let received = false

      client.unsubscribe('test', function (err) {
        assert.ifError(err)
        assert(received)
        client.end(done)
      })

      server.once('client', function (serverClient) {
        serverClient.once('unsubscribe', function (packet) {
          assert.include(packet.unsubscriptions, 'test')
          received = true
        })
      })
    })

    it('should send an unsubscribe packet', function (done) {
      const client = connect()
      const topic = 'topic'
      let received = false

      client.once('connect', function () {
        client.unsubscribe(topic, function (err) {
          assert.ifError(err)
          assert(received)
          client.end(done)
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('unsubscribe', function (packet) {
          assert.include(packet.unsubscriptions, topic)
          received = true
        })
      })
    })

    it('should emit a packetsend event', function (done) {
      const client = connect()
      const testTopic = 'testTopic'

      client.once('connect', function () {
        client.subscribe(testTopic)
      })

      client.on('packetsend', function (packet) {
        if (packet.cmd === 'subscribe') {
          client.end(true, done)
        }
      })
    })

    it('should emit a packetreceive event', function (done) {
      const client = connect()
      const testTopic = 'testTopic'

      client.once('connect', function () {
        client.subscribe(testTopic)
      })

      client.on('packetreceive', function (packet) {
        if (packet.cmd === 'suback') {
          client.end(true, done)
        }
      })
    })

    it('should accept an array of unsubs', function (done) {
      const client = connect()
      const topics = ['topic1', 'topic2']
      let received = false

      client.once('connect', function () {
        client.unsubscribe(topics, function (err) {
          assert.ifError(err)
          assert(received)
          client.end(done)
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('unsubscribe', function (packet) {
          assert.deepStrictEqual(packet.unsubscriptions, topics)
          received = true
        })
      })
    })

    it('should fire a callback on unsuback', function (done) {
      const client = connect()
      const topic = 'topic'

      client.once('connect', function () {
        client.unsubscribe(topic, () => {
          client.end(true, done)
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('unsubscribe', function (packet) {
          serverClient.unsuback(packet)
        })
      })
    })

    it('should unsubscribe from a chinese topic', function (done) {
      const client = connect()
      const topic = '中国'

      client.once('connect', function () {
        client.unsubscribe(topic, () => {
          client.end(err => {
            done(err)
          })
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('unsubscribe', function (packet) {
          assert.include(packet.unsubscriptions, topic)
        })
      })
    })
  })

  describe('keepalive', function () {
    let clock

    // eslint-disable-next-line
    beforeEach(function () {
      clock = sinon.useFakeTimers()
    })

    afterEach(function () {
      clock.restore()
    })

    it('should checkPing at keepalive interval', function (done) {
      const interval = 3
      const client = connect({ keepalive: interval })

      client._checkPing = sinon.spy()

      client.once('connect', function () {
        clock.tick(interval * 1000)
        assert.strictEqual(client._checkPing.callCount, 1)

        clock.tick(interval * 1000)
        assert.strictEqual(client._checkPing.callCount, 2)

        clock.tick(interval * 1000)
        assert.strictEqual(client._checkPing.callCount, 3)

        client.end(true, done)
      })
    })

    it('should not checkPing if publishing at a higher rate than keepalive', function (done) {
      const intervalMs = 3000
      const client = connect({ keepalive: intervalMs / 1000 })

      client._checkPing = sinon.spy()

      client.once('connect', function () {
        client.publish('foo', 'bar')
        clock.tick(intervalMs - 1)
        client.publish('foo', 'bar')
        clock.tick(2)

        assert.strictEqual(client._checkPing.callCount, 0)
        client.end(true, done)
      })
    })

    it('should checkPing if publishing at a higher rate than keepalive and reschedulePings===false', function (done) {
      const intervalMs = 3000
      const client = connect({
        keepalive: intervalMs / 1000,
        reschedulePings: false
      })

      client._checkPing = sinon.spy()

      client.once('connect', function () {
        client.publish('foo', 'bar')
        clock.tick(intervalMs - 1)
        client.publish('foo', 'bar')
        clock.tick(2)

        assert.strictEqual(client._checkPing.callCount, 1)
        client.end(true, done)
      })
    })
  })

  describe('pinging', function () {
    it('should set a ping timer', function (done) {
      const client = connect({ keepalive: 3 })
      client.once('connect', function () {
        assert.exists(client.pingTimer)
        client.end(true, done)
      })
    })

    it('should not set a ping timer keepalive=0', function (done) {
      const client = connect({ keepalive: 0 })
      client.on('connect', function () {
        assert.notExists(client.pingTimer)
        client.end(true, done)
      })
    })

    it('should reconnect if pingresp is not sent', function (done) {
      this.timeout(4000)
      const client = connect({ keepalive: 1, reconnectPeriod: 100 })

      // Fake no pingresp being send by stubbing the _handlePingresp function
      client._handlePingresp = function () { }

      client.once('connect', function () {
        client.once('connect', function () {
          client.end(true, done)
        })
      })
    })

    it('should not reconnect if pingresp is successful', function (done) {
      const client = connect({ keepalive: 100 })
      client.once('close', function () {
        done(new Error('Client closed connection'))
      })
      setTimeout(done, 1000)
    })

    it('should defer the next ping when sending a control packet', function (done) {
      const client = connect({ keepalive: 1 })

      client.once('connect', function () {
        client._checkPing = sinon.spy()

        client.publish('foo', 'bar')
        setTimeout(function () {
          assert.strictEqual(client._checkPing.callCount, 0)
          client.publish('foo', 'bar')

          setTimeout(function () {
            assert.strictEqual(client._checkPing.callCount, 0)
            client.publish('foo', 'bar')

            setTimeout(function () {
              assert.strictEqual(client._checkPing.callCount, 0)
              done()
            }, 75)
          }, 75)
        }, 75)
      })
    })
  })

  describe('subscribing', function () {
    it('should send a subscribe message (offline)', function (done) {
      const client = connect()

      client.subscribe('test')

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function () {
          done()
        })
      })
    })

    it('should send a subscribe message', function (done) {
      const client = connect()
      const topic = 'test'

      client.once('connect', function () {
        client.subscribe(topic)
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          const result = {
            topic,
            qos: 0
          }
          if (version === 5) {
            result.nl = false
            result.rap = false
            result.rh = 0
          }
          assert.include(packet.subscriptions[0], result)
          done()
        })
      })
    })

    it('should emit a packetsend event', function (done) {
      const client = connect()
      const testTopic = 'testTopic'

      client.once('connect', function () {
        client.subscribe(testTopic)
      })

      client.on('packetsend', function (packet) {
        if (packet.cmd === 'subscribe') {
          done()
        }
      })
    })

    it('should emit a packetreceive event', function (done) {
      const client = connect()
      const testTopic = 'testTopic'

      client.once('connect', function () {
        client.subscribe(testTopic)
      })

      client.on('packetreceive', function (packet) {
        if (packet.cmd === 'suback') {
          done()
        }
      })
    })

    it('should accept an array of subscriptions', function (done) {
      const client = connect()
      const subs = ['test1', 'test2']

      client.once('connect', function () {
        client.subscribe(subs)
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          // i.e. [{topic: 'a', qos: 0}, {topic: 'b', qos: 0}]
          const expected = subs.map(function (i) {
            const result = { topic: i, qos: 0 }
            if (version === 5) {
              result.nl = false
              result.rap = false
              result.rh = 0
            }
            return result
          })

          assert.deepStrictEqual(packet.subscriptions, expected)
          client.end(done)
        })
      })
    })

    it('should accept a hash of subscriptions', function (done) {
      const client = connect()
      const topics = {
        test1: { qos: 0 },
        test2: { qos: 1 }
      }

      client.once('connect', function () {
        client.subscribe(topics)
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          const expected = []

          for (const k in topics) {
            if (Object.prototype.hasOwnProperty.call(topics, k)) {
              const result = {
                topic: k,
                qos: topics[k].qos
              }
              if (version === 5) {
                result.nl = false
                result.rap = false
                result.rh = 0
              }
              expected.push(result)
            }
          }

          assert.deepStrictEqual(packet.subscriptions, expected)
          client.end(done)
        })
      })
    })

    it('should accept an options parameter', function (done) {
      const client = connect()
      const topic = 'test'
      const opts = { qos: 1 }

      client.once('connect', function () {
        client.subscribe(topic, opts)
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          const expected = [{
            topic,
            qos: 1
          }]

          if (version === 5) {
            expected[0].nl = false
            expected[0].rap = false
            expected[0].rh = 0
          }

          assert.deepStrictEqual(packet.subscriptions, expected)
          done()
        })
      })
    })

    it('should subscribe with the default options for an empty options parameter', function (done) {
      const client = connect()
      const topic = 'test'
      const defaultOpts = { qos: 0 }

      client.once('connect', function () {
        client.subscribe(topic, {})
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          const result = {
            topic,
            qos: defaultOpts.qos
          }
          if (version === 5) {
            result.nl = false
            result.rap = false
            result.rh = 0
          }

          assert.include(packet.subscriptions[0], result)
          client.end(err => done(err))
        })
      })
    })

    it('should fire a callback on suback', function (done) {
      const client = connect()
      const topic = 'test'

      client.once('connect', function () {
        client.subscribe(topic, { qos: 2 }, function (err, granted) {
          if (err) {
            done(err)
          } else {
            assert.exists(granted, 'granted not given')
            const expectedResult = { topic: 'test', qos: 2 }
            if (version === 5) {
              expectedResult.nl = false
              expectedResult.rap = false
              expectedResult.rh = 0
              expectedResult.properties = undefined
            }
            assert.include(granted[0], expectedResult)
            client.end(err => done(err))
          }
        })
      })
    })

    it('should fire a callback with error if disconnected (options provided)', function (done) {
      const client = connect()
      const topic = 'test'
      client.once('connect', function () {
        client.end(true, function () {
          client.subscribe(topic, { qos: 2 }, function (err, granted) {
            assert.notExists(granted, 'granted given')
            assert.exists(err, 'no error given')
            done()
          })
        })
      })
    })

    it('should fire a callback with error if disconnected (options not provided)', function (done) {
      const client = connect()
      const topic = 'test'

      client.once('connect', function () {
        client.end(true, function () {
          client.subscribe(topic, function (err, granted) {
            assert.notExists(granted, 'granted given')
            assert.exists(err, 'no error given')
            done()
          })
        })
      })
    })

    it('should subscribe with a chinese topic', function (done) {
      const client = connect()
      const topic = '中国'

      client.once('connect', function () {
        client.subscribe(topic)
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function (packet) {
          const result = {
            topic,
            qos: 0
          }
          if (version === 5) {
            result.nl = false
            result.rap = false
            result.rh = 0
          }
          assert.include(packet.subscriptions[0], result)
          client.end(done)
        })
      })
    })
  })

  describe('receiving messages', function () {
    it('should fire the message event', function (done) {
      const client = connect()
      const testPacket = {
        topic: 'test',
        payload: 'message',
        retain: true,
        qos: 1,
        messageId: 5
      }

      //
      client.subscribe(testPacket.topic)
      client.once('message', function (topic, message, packet) {
        assert.strictEqual(topic, testPacket.topic)
        assert.strictEqual(message.toString(), testPacket.payload)
        assert.strictEqual(packet.cmd, 'publish')
        client.end(true, done)
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
        })
      })
    })

    it('should emit a packetreceive event', function (done) {
      const client = connect()
      const testPacket = {
        topic: 'test',
        payload: 'message',
        retain: true,
        qos: 1,
        messageId: 5
      }

      client.subscribe(testPacket.topic)
      client.on('packetreceive', function (packet) {
        if (packet.cmd === 'publish') {
          assert.strictEqual(packet.qos, 1)
          assert.strictEqual(packet.topic, testPacket.topic)
          assert.strictEqual(packet.payload.toString(), testPacket.payload)
          assert.strictEqual(packet.retain, true)
          client.end(true, done)
        }
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
        })
      })
    })

    it('should support binary data', function (done) {
      const client = connect({ encoding: 'binary' })
      const testPacket = {
        topic: 'test',
        payload: 'message',
        retain: true,
        qos: 1,
        messageId: 5
      }

      client.subscribe(testPacket.topic)
      client.once('message', function (topic, message, packet) {
        assert.strictEqual(topic, testPacket.topic)
        assert.instanceOf(message, Buffer)
        assert.strictEqual(message.toString(), testPacket.payload)
        assert.strictEqual(packet.cmd, 'publish')
        client.end(true, done)
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
        })
      })
    })

    it('should emit a message event (qos=2)', function (done) {
      const client = connect()
      const testPacket = {
        topic: 'test',
        payload: 'message',
        retain: true,
        qos: 2,
        messageId: 5
      }

      server.testPublish = testPacket

      client.subscribe(testPacket.topic)
      client.once('message', function (topic, message, packet) {
        assert.strictEqual(topic, testPacket.topic)
        assert.strictEqual(message.toString(), testPacket.payload)
        assert.strictEqual(packet.messageId, testPacket.messageId)
        assert.strictEqual(packet.qos, testPacket.qos)
        client.end(true, done)
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
        })
      })
    })

    it('should emit a message event (qos=2) - repeated publish', function (done) {
      const client = connect()
      const testPacket = {
        topic: 'test',
        payload: 'message',
        retain: true,
        qos: 2,
        messageId: 5
      }

      server.testPublish = testPacket

      const messageHandler = function (topic, message, packet) {
        assert.strictEqual(topic, testPacket.topic)
        assert.strictEqual(message.toString(), testPacket.payload)
        assert.strictEqual(packet.messageId, testPacket.messageId)
        assert.strictEqual(packet.qos, testPacket.qos)

        assert.strictEqual(spiedMessageHandler.callCount, 1)
        client.end(true, done)
      }

      const spiedMessageHandler = sinon.spy(messageHandler)

      client.subscribe(testPacket.topic)
      client.on('message', spiedMessageHandler)

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
          // twice, should be ignored
          serverClient.publish(testPacket)
        })
      })
    })

    it('should support a chinese topic', function (done) {
      const client = connect({ encoding: 'binary' })
      const testPacket = {
        topic: '国',
        payload: 'message',
        retain: true,
        qos: 1,
        messageId: 5
      }

      client.subscribe(testPacket.topic)
      client.once('message', function (topic, message, packet) {
        assert.strictEqual(topic, testPacket.topic)
        assert.instanceOf(message, Buffer)
        assert.strictEqual(message.toString(), testPacket.payload)
        assert.strictEqual(packet.messageId, testPacket.messageId)
        assert.strictEqual(packet.qos, testPacket.qos)
        client.end(true, done)
      })

      server.once('client', function (serverClient) {
        serverClient.on('subscribe', function () {
          serverClient.publish(testPacket)
        })
      })
    })
  })

  describe('qos handling', function () {
    it('should follow qos 0 semantics (trivial)', function (done) {
      const client = connect()
      const testTopic = 'test'
      const testMessage = 'message'

      client.once('connect', function () {
        client.subscribe(testTopic, { qos: 0 }, () => {
          client.end(true, done)
        })
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function () {
          serverClient.publish({
            topic: testTopic,
            payload: testMessage,
            qos: 0,
            retain: false
          })
        })
      })
    })

    it('should follow qos 1 semantics', function (done) {
      const client = connect()
      const testTopic = 'test'
      const testMessage = 'message'
      const mid = 50

      client.once('connect', function () {
        client.subscribe(testTopic, { qos: 1 })
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function () {
          serverClient.publish({
            topic: testTopic,
            payload: testMessage,
            messageId: mid,
            qos: 1
          })
        })

        serverClient.once('puback', function (packet) {
          assert.strictEqual(packet.messageId, mid)
          client.end(done)
        })
      })
    })

    it('should follow qos 2 semantics', function (done) {
      const client = connect()
      const testTopic = 'test'
      const testMessage = 'message'
      const mid = 253
      let publishReceived = 0
      let pubrecReceived = 0
      let pubrelReceived = 0

      client.once('connect', function () {
        client.subscribe(testTopic, { qos: 2 })
      })

      client.on('packetreceive', (packet) => {
        switch (packet.cmd) {
          case 'connack':
          case 'suback':
            // expected, but not specifically part of QOS 2 semantics
            break
          case 'publish':
            assert.strictEqual(pubrecReceived, 0, 'server received pubrec before client sent')
            assert.strictEqual(pubrelReceived, 0, 'server received pubrec before client sent')
            publishReceived += 1
            break
          case 'pubrel':
            assert.strictEqual(publishReceived, 1, 'only 1 publish must be received before a pubrel')
            assert.strictEqual(pubrecReceived, 1, 'invalid number of PUBREC messages (not only 1)')
            pubrelReceived += 1
            break
          default:
            should.fail()
        }
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function () {
          serverClient.publish({
            topic: testTopic,
            payload: testMessage,
            qos: 2,
            messageId: mid
          })
        })

        serverClient.on('pubrec', function () {
          assert.strictEqual(publishReceived, 1, 'invalid number of PUBLISH messages received')
          assert.strictEqual(pubrecReceived, 0, 'invalid number of PUBREC messages recevied')
          pubrecReceived += 1
        })

        serverClient.once('pubcomp', function () {
          client.removeAllListeners()
          serverClient.removeAllListeners()
          assert.strictEqual(publishReceived, 1, 'invalid number of PUBLISH messages')
          assert.strictEqual(pubrecReceived, 1, 'invalid number of PUBREC messages')
          assert.strictEqual(pubrelReceived, 1, 'invalid nubmer of PUBREL messages')
          client.end(true, done)
        })
      })
    })

    it('should should empty the incoming store after a qos 2 handshake is completed', function (done) {
      const client = connect()
      const testTopic = 'test'
      const testMessage = 'message'
      const mid = 253

      client.once('connect', function () {
        client.subscribe(testTopic, { qos: 2 })
      })

      client.on('packetreceive', (packet) => {
        if (packet.cmd === 'pubrel') {
          assert.strictEqual(client.incomingStore._inflights.size, 1)
        }
      })

      server.once('client', function (serverClient) {
        serverClient.once('subscribe', function () {
          serverClient.publish({
            topic: testTopic,
            payload: testMessage,
            qos: 2,
            messageId: mid
          })
        })

        serverClient.once('pubcomp', function () {
          assert.strictEqual(client.incomingStore._inflights.size, 0)
          client.removeAllListeners()
          client.end(true, done)
        })
      })
    })

    function testMultiplePubrel (shouldSendPubcompFail, done) {
      const client = connect()
      const testTopic = 'test'
      const testMessage = 'message'
      const mid = 253
      let pubcompCount = 0
      let pubrelCount = 0
      let handleMessageCount = 0
      let emitMessageCount = 0
      const origSendPacket = client._sendPacket
      let shouldSendFail

      client.handleMessage = function (packet, callback) {
        handleMessageCount++
        callback()
      }

      client.on('message', function () {
        emitMessageCount++
      })

      client._sendPacket = function (packet, sendDone) {
        shouldSendFail = packet.cmd === 'pubcomp' && shouldSendPubcompFail
        if (sendDone) {
          sendDone(shouldSendFail ? new Error('testing pubcomp failure') : undefined)
        }

        // send the mocked response
        switch (packet.cmd) {
          case 'subscribe': {
            const suback = { cmd: 'suback', messageId: packet.messageId, granted: [2] }
            client._handlePacket(suback, function (err) {
              assert.isNotOk(err)
            })
            break
          }
          case 'pubrec':
          case 'pubcomp':
          {
            // for both pubrec and pubcomp, reply with pubrel, simulating the server not receiving the pubcomp
            if (packet.cmd === 'pubcomp') {
              pubcompCount++
              if (pubcompCount === 2) {
                // end the test once the client has gone through two rounds of replying to pubrel messages
                assert.strictEqual(pubrelCount, 2)
                assert.strictEqual(handleMessageCount, 1)
                assert.strictEqual(emitMessageCount, 1)
                client._sendPacket = origSendPacket
                client.end(true, done)
                break
              }
            }

            // simulate the pubrel message, either in response to pubrec or to mock pubcomp failing to be received
            const pubrel = { cmd: 'pubrel', messageId: mid }
            pubrelCount++
            client._handlePacket(pubrel, function (err) {
              if (shouldSendFail) {
                assert.exists(err)
                assert.instanceOf(err, Error)
              } else {
                assert.notExists(err)
              }
            })
            break
          }
        }
      }

      client.once('connect', function () {
        client.subscribe(testTopic, { qos: 2 })
        const publish = { cmd: 'publish', topic: testTopic, payload: testMessage, qos: 2, messageId: mid }
        client._handlePacket(publish, function (err) {
          assert.notExists(err)
        })
      })
    }

    it('handle qos 2 messages exactly once when multiple pubrel received', function (done) {
      testMultiplePubrel(false, done)
    })

    it('handle qos 2 messages exactly once when multiple pubrel received and sending pubcomp fails on client', function (done) {
      testMultiplePubrel(true, done)
    })
  })

  describe('auto reconnect', function () {
    it('should mark the client disconnecting if #end called', function (done) {
      const client = connect()

      client.end(true, err => {
        assert.isTrue(client.disconnecting)
        done(err)
      })
    })

    it('should reconnect after stream disconnect', function (done) {
      const client = connect()

      let tryReconnect = true

      client.on('connect', function () {
        if (tryReconnect) {
          client.stream.end()
          tryReconnect = false
        } else {
          client.end(true, done)
        }
      })
    })

    it('should emit \'reconnect\' when reconnecting', function (done) {
      const client = connect()
      let tryReconnect = true
      let reconnectEvent = false

      client.on('reconnect', function () {
        reconnectEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.stream.end()
          tryReconnect = false
        } else {
          assert.isTrue(reconnectEvent)
          client.end(true, done)
        }
      })
    })

    it('should emit \'offline\' after going offline', function (done) {
      const client = connect()

      let tryReconnect = true
      let offlineEvent = false

      client.on('offline', function () {
        offlineEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.stream.end()
          tryReconnect = false
        } else {
          assert.isTrue(offlineEvent)
          client.end(true, done)
        }
      })
    })

    it('should not reconnect if it was ended by the user', function (done) {
      const client = connect()

      client.on('connect', function () {
        client.end()
        done() // it will raise an exception if called two times
      })
    })

    it('should setup a reconnect timer on disconnect', function (done) {
      const client = connect()

      client.once('connect', function () {
        assert.notExists(client.reconnectTimer)
        client.stream.end()
      })

      client.once('close', function () {
        assert.exists(client.reconnectTimer)
        client.end(true, done)
      })
    })

    const reconnectPeriodTests = [{ period: 200 }, { period: 2000 }, { period: 4000 }]
    reconnectPeriodTests.forEach((test) => {
      it('should allow specification of a reconnect period (' + test.period + 'ms)', function (done) {
        this.timeout(10000)
        let end
        const reconnectSlushTime = 200
        const client = connect({ reconnectPeriod: test.period })
        let reconnect = false
        const start = Date.now()

        client.on('connect', function () {
          if (!reconnect) {
            client.stream.end()
            reconnect = true
          } else {
            end = Date.now()
            client.end(() => {
              const reconnectPeriodDuringTest = end - start
              if (reconnectPeriodDuringTest >= test.period - reconnectSlushTime && reconnectPeriodDuringTest <= test.period + reconnectSlushTime) {
                // give the connection a 200 ms slush window
                done()
              } else {
                done(new Error('Strange reconnect period: ' + reconnectPeriodDuringTest))
              }
            })
          }
        })
      })
    })

    it('should always cleanup successfully on reconnection', function (done) {
      const client = connect({ host: 'this_hostname_should_not_exist', connectTimeout: 0, reconnectPeriod: 1 })
      // bind client.end so that when it is called it is automatically passed in the done callback
      setTimeout(() => {
        const boundEnd = client.end.bind(client, done)
        boundEnd()
      }, 50)
    })

    it('should resend in-flight QoS 1 publish messages from the client', function (done) {
      this.timeout(4000)
      const client = connect({ reconnectPeriod: 200 })
      let serverPublished = false
      let clientCalledBack = false

      server.once('client', function (serverClient) {
        serverClient.on('connect', function () {
          setImmediate(function () {
            serverClient.stream.destroy()
          })
        })

        server.once('client', function (serverClientNew) {
          serverClientNew.on('publish', function () {
            serverPublished = true
            check()
          })
        })
      })

      client.publish('hello', 'world', { qos: 1 }, function () {
        clientCalledBack = true
        check()
      })

      function check () {
        if (serverPublished && clientCalledBack) {
          client.end(true, done)
        }
      }
    })

    it('should not resend in-flight publish messages if disconnecting', function (done) {
      const client = connect({ reconnectPeriod: 200 })
      let serverPublished = false
      let clientCalledBack = false
      server.once('client', function (serverClient) {
        serverClient.on('connect', function () {
          setImmediate(function () {
            serverClient.stream.destroy()
            client.end(true, err => {
              assert.isFalse(serverPublished)
              assert.isFalse(clientCalledBack)
              done(err)
            })
          })
        })
        server.once('client', function (serverClientNew) {
          serverClientNew.on('publish', function () {
            serverPublished = true
          })
        })
      })
      client.publish('hello', 'world', { qos: 1 }, function () {
        clientCalledBack = true
      })
    })

    it('should resend in-flight QoS 2 publish messages from the client', function (done) {
      const client = connect({ reconnectPeriod: 200 })
      let serverPublished = false
      let clientCalledBack = false

      server.once('client', function (serverClient) {
        // ignore errors
        serverClient.on('error', function () { })
        serverClient.on('publish', function () {
          setImmediate(function () {
            serverClient.stream.destroy()
          })
        })

        server.once('client', function (serverClientNew) {
          serverClientNew.on('pubrel', function () {
            serverPublished = true
            check()
          })
        })
      })

      client.publish('hello', 'world', { qos: 2 }, function () {
        clientCalledBack = true
        check()
      })

      function check () {
        if (serverPublished && clientCalledBack) {
          client.end(true, done)
        }
      }
    })

    it('should not resend in-flight QoS 1 removed publish messages from the client', function (done) {
      const client = connect({ reconnectPeriod: 200 })
      let clientCalledBack = false

      server.once('client', function (serverClient) {
        serverClient.on('connect', function () {
          setImmediate(function () {
            serverClient.stream.destroy()
          })
        })

        server.once('client', function (serverClientNew) {
          serverClientNew.on('publish', function () {
            should.fail()
            done()
          })
        })
      })

      client.publish('hello', 'world', { qos: 1 }, function (err) {
        clientCalledBack = true
        assert.exists(err, 'error should exist')
        assert.strictEqual(err.message, 'Message removed', 'error message is incorrect')
      })
      assert.strictEqual(Object.keys(client.outgoing).length, 1)
      assert.strictEqual(client.outgoingStore._inflights.size, 1)
      client.removeOutgoingMessage(client.getLastMessageId())
      assert.strictEqual(Object.keys(client.outgoing).length, 0)
      assert.strictEqual(client.outgoingStore._inflights.size, 0)
      assert.isTrue(clientCalledBack)
      client.end(true, (err) => {
        done(err)
      })
    })

    it('should not resend in-flight QoS 2 removed publish messages from the client', function (done) {
      const client = connect({ reconnectPeriod: 200 })
      let clientCalledBack = false

      server.once('client', function (serverClient) {
        serverClient.on('connect', function () {
          setImmediate(function () {
            serverClient.stream.destroy()
          })
        })

        server.once('client', function (serverClientNew) {
          serverClientNew.on('publish', function () {
            should.fail()
            done()
          })
        })
      })

      client.publish('hello', 'world', { qos: 2 }, function (err) {
        clientCalledBack = true
        assert.strictEqual(err.message, 'Message removed')
      })
      assert.strictEqual(Object.keys(client.outgoing).length, 1)
      assert.strictEqual(client.outgoingStore._inflights.size, 1)
      client.removeOutgoingMessage(client.getLastMessageId())
      assert.strictEqual(Object.keys(client.outgoing).length, 0)
      assert.strictEqual(client.outgoingStore._inflights.size, 0)
      assert.isTrue(clientCalledBack)
      client.end(true, done)
    })

    it('should resubscribe when reconnecting', function (done) {
      const client = connect({ reconnectPeriod: 100 })
      let tryReconnect = true
      let reconnectEvent = false

      client.on('reconnect', function () {
        reconnectEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.subscribe('hello', function () {
            client.stream.end()

            server.once('client', function (serverClient) {
              serverClient.on('subscribe', function () {
                client.end(done)
              })
            })
          })

          tryReconnect = false
        } else {
          assert.isTrue(reconnectEvent)
        }
      })
    })

    it('should not resubscribe when reconnecting if resubscribe is disabled', function (done) {
      const client = connect({ reconnectPeriod: 100, resubscribe: false })
      let tryReconnect = true
      let reconnectEvent = false

      client.on('reconnect', function () {
        reconnectEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.subscribe('hello', function () {
            client.stream.end()

            server.once('client', function (serverClient) {
              serverClient.on('subscribe', function () {
                should.fail()
              })
            })
          })

          tryReconnect = false
        } else {
          assert.isTrue(reconnectEvent)
          assert.strictEqual(Object.keys(client._resubscribeTopics).length, 0)
          client.end(true, done)
        }
      })
    })

    it('should not resubscribe when reconnecting if suback is error', function (done) {
      let tryReconnect = true
      let reconnectEvent = false
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('subscribe', function (packet) {
          serverClient.suback({
            messageId: packet.messageId,
            granted: packet.subscriptions.map(function (e) {
              return e.qos | 0x80
            })
          })
          serverClient.pubrel({ messageId: Math.floor(Math.random() * 9000) + 1000 })
        })
      })

      server2.listen(ports.PORTAND49, function () {
        const client = connect({
          port: ports.PORTAND49,
          host: 'localhost',
          reconnectPeriod: 100
        })

        client.on('reconnect', function () {
          reconnectEvent = true
        })

        client.on('connect', function () {
          if (tryReconnect) {
            client.subscribe('hello', function () {
              client.stream.end()

              server.once('client', function (serverClient) {
                serverClient.on('subscribe', function () {
                  should.fail()
                })
              })
            })
            tryReconnect = false
          } else {
            assert.isTrue(reconnectEvent)
            assert.strictEqual(Object.keys(client._resubscribeTopics).length, 0)
            client.end(true, (err1) => {
              server2.close((err2) => done(err1 || err2))
            })
          }
        })
      })
    })

    it('should preserved incomingStore after disconnecting if clean is false', function (done) {
      let reconnect = false
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
          if (reconnect) {
            serverClient.pubrel({ messageId: 1 })
          }
        })
        serverClient.on('subscribe', function (packet) {
          serverClient.suback({
            messageId: packet.messageId,
            granted: packet.subscriptions.map(function (e) {
              return e.qos
            })
          })
          serverClient.publish({ topic: 'topic', payload: 'payload', qos: 2, messageId: 1, retain: false })
        })
        serverClient.on('pubrec', function (packet) {
          client.end(false, function () {
            client.reconnect({
              incomingStore,
              outgoingStore
            })
          })
        })
        serverClient.on('pubcomp', function (packet) {
          client.end(true, (err1) => {
            server2.close((err2) => done(err1 || err2))
          })
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.on('connect', function () {
          if (!reconnect) {
            client.subscribe('test', { qos: 2 }, function () {
            })
            reconnect = true
          }
        })
        client.on('message', function (topic, message) {
          assert.strictEqual(topic, 'topic')
          assert.strictEqual(message.toString(), 'payload')
        })
      })
    })

    it('should clear outgoing if close from server', function (done) {
      let reconnect = false
      let client = {}
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('subscribe', function (packet) {
          if (reconnect) {
            serverClient.suback({
              messageId: packet.messageId,
              granted: packet.subscriptions.map(function (e) {
                return e.qos
              })
            })
          } else {
            serverClient.destroy()
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: true,
          clientId: 'cid1',
          keepalive: 1,
          reconnectPeriod: 0
        })

        client.on('connect', function () {
          client.subscribe('test', { qos: 2 }, function (e) {
            if (!e) {
              client.end()
            }
          })
        })

        client.on('close', function () {
          if (reconnect) {
            server2.close((err) => done(err))
          } else {
            assert.strictEqual(Object.keys(client.outgoing).length, 0)
            reconnect = true
            client.reconnect()
          }
        })
      })
    })

    it('should resend in-flight QoS 1 publish messages from the client if clean is false', function (done) {
      let reconnect = false
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (reconnect) {
            client.end(true, (err1) => {
              server2.close((err2) => done(err1 || err2))
            })
          } else {
            client.end(true, () => {
              client.reconnect({
                incomingStore,
                outgoingStore
              })
              reconnect = true
            })
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.on('connect', function () {
          if (!reconnect) {
            client.publish('topic', 'payload', { qos: 1 })
          }
        })
        client.on('error', function () { })
      })
    })

    it('should resend in-flight QoS 2 publish messages from the client if clean is false', function (done) {
      let reconnect = false
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (reconnect) {
            client.end(true, (err1) => {
              server2.close((err2) => done(err1 || err2))
            })
          } else {
            client.end(true, function () {
              client.reconnect({
                incomingStore,
                outgoingStore
              })
              reconnect = true
            })
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.on('connect', function () {
          if (!reconnect) {
            client.publish('topic', 'payload', { qos: 2 })
          }
        })
        client.on('error', function () { })
      })
    })

    it('should resend in-flight QoS 2 pubrel messages from the client if clean is false', function (done) {
      let reconnect = false
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          if (!reconnect) {
            serverClient.pubrec({ messageId: packet.messageId })
          }
        })
        serverClient.on('pubrel', function (packet) {
          if (reconnect) {
            serverClient.pubcomp({ messageId: packet.messageId })
          } else {
            client.end(true, function () {
              client.reconnect({
                incomingStore,
                outgoingStore
              })
              reconnect = true
            })
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.on('connect', function () {
          if (!reconnect) {
            client.publish('topic', 'payload', { qos: 2 }, function (err) {
              assert(reconnect)
              assert.ifError(err)
              client.end(true, (err1) => {
                server2.close((err2) => done(err1 || err2))
              })
            })
          }
        })
        client.on('error', function () { })
      })
    })

    it('should resend in-flight publish messages by published order', function (done) {
      let publishCount = 0
      let reconnect = false
      let disconnectOnce = true
      let client = {}
      const incomingStore = new mqtt.Store({ clean: false })
      const outgoingStore = new mqtt.Store({ clean: false })
      const server2 = serverBuilder(config.protocol, function (serverClient) {
        // errors are not interesting for this test
        // but they might happen on some platforms
        serverClient.on('error', function () { })

        serverClient.on('connect', function (packet) {
          const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }
          serverClient.connack(connack)
        })
        serverClient.on('publish', function (packet) {
          serverClient.puback({ messageId: packet.messageId })
          if (reconnect) {
            switch (publishCount++) {
              case 0:
                assert.strictEqual(packet.payload.toString(), 'payload1')
                break
              case 1:
                assert.strictEqual(packet.payload.toString(), 'payload2')
                break
              case 2:
                assert.strictEqual(packet.payload.toString(), 'payload3')
                client.end(true, (err1) => {
                  server2.close((err2) => done(err1 || err2))
                })
                break
            }
          } else {
            if (disconnectOnce) {
              client.end(true, function () {
                reconnect = true
                client.reconnect({
                  incomingStore,
                  outgoingStore
                })
              })
              disconnectOnce = false
            }
          }
        })
      })

      server2.listen(ports.PORTAND50, function () {
        client = connect({
          port: ports.PORTAND50,
          host: 'localhost',
          clean: false,
          clientId: 'cid1',
          reconnectPeriod: 0,
          incomingStore,
          outgoingStore
        })

        client.nextId = 65535

        client.on('connect', function () {
          if (!reconnect) {
            client.publish('topic', 'payload1', { qos: 1 })
            client.publish('topic', 'payload2', { qos: 1 })
            client.publish('topic', 'payload3', { qos: 1 })
          }
        })
        client.on('error', function () { })
      })
    })

    it('should be able to pub/sub if reconnect() is called at close handler', function (done) {
      const client = connect({ reconnectPeriod: 0 })
      let tryReconnect = true
      let reconnectEvent = false

      client.on('close', function () {
        if (tryReconnect) {
          tryReconnect = false
          client.reconnect()
        } else {
          assert.isTrue(reconnectEvent)
          done()
        }
      })

      client.on('reconnect', function () {
        reconnectEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.end()
        } else {
          client.subscribe('hello', function () {
            client.end()
          })
        }
      })
    })

    it('should be able to pub/sub if reconnect() is called at out of close handler', function (done) {
      const client = connect({ reconnectPeriod: 0 })
      let tryReconnect = true
      let reconnectEvent = false

      client.on('close', function () {
        if (tryReconnect) {
          tryReconnect = false
          setTimeout(function () {
            client.reconnect()
          }, 100)
        } else {
          assert.isTrue(reconnectEvent)
          done()
        }
      })

      client.on('reconnect', function () {
        reconnectEvent = true
      })

      client.on('connect', function () {
        if (tryReconnect) {
          client.end()
        } else {
          client.subscribe('hello', function () {
            client.end()
          })
        }
      })
    })

    context('with alternate server client', function () {
      let cachedClientListeners
      const connack = version === 5 ? { reasonCode: 0 } : { returnCode: 0 }

      beforeEach(function () {
        cachedClientListeners = server.listeners('client')
        server.removeAllListeners('client')
      })

      afterEach(function () {
        server.removeAllListeners('client')
        cachedClientListeners.forEach(function (listener) {
          server.on('client', listener)
        })
      })

      it('should resubscribe even if disconnect is before suback', function (done) {
        const client = connect(Object.assign({ reconnectPeriod: 100 }, config))
        let subscribeCount = 0
        let connectCount = 0

        server.on('client', function (serverClient) {
          serverClient.on('connect', function () {
            connectCount++
            serverClient.connack(connack)
          })

          serverClient.on('subscribe', function () {
            subscribeCount++

            // disconnect before sending the suback on the first subscribe
            if (subscribeCount === 1) {
              client.stream.end()
            }

            // after the second connection, confirm that the only two
            // subscribes have taken place, then cleanup and exit
            if (connectCount >= 2) {
              assert.strictEqual(subscribeCount, 2)
              client.end(true, done)
            }
          })
        })

        client.subscribe('hello')
      })

      it('should resubscribe exactly once', function (done) {
        const client = connect(Object.assign({ reconnectPeriod: 100 }, config))
        let subscribeCount = 0

        server.on('client', function (serverClient) {
          serverClient.on('connect', function () {
            serverClient.connack(connack)
          })

          serverClient.on('subscribe', function () {
            subscribeCount++

            // disconnect before sending the suback on the first subscribe
            if (subscribeCount === 1) {
              client.stream.end()
            }

            // after the second connection, only two subs
            // subscribes have taken place, then cleanup and exit
            if (subscribeCount === 2) {
              client.end(true, done)
            }
          })
        })

        client.subscribe('hello')
      })
    })
  })

  describe('message id to subscription topic mapping', () => {
    it('should not create a mapping if resubscribe is disabled', function (done) {
      const client = connect({ resubscribe: false })
      client.subscribe('test1')
      client.subscribe('test2')
      assert.strictEqual(Object.keys(client.messageIdToTopic).length, 0)
      client.end(true, done)
    })

    it('should create a mapping for each subscribe call', function (done) {
      const client = connect()
      client.subscribe('test1')
      assert.strictEqual(Object.keys(client.messageIdToTopic).length, 1)
      client.subscribe('test2')
      assert.strictEqual(Object.keys(client.messageIdToTopic).length, 2)

      client.subscribe(['test3', 'test4'])
      assert.strictEqual(Object.keys(client.messageIdToTopic).length, 3)
      client.subscribe(['test5', 'test6'])
      assert.strictEqual(Object.keys(client.messageIdToTopic).length, 4)

      client.end(true, done)
    })

    it('should remove the mapping after suback', function (done) {
      const client = connect()
      client.once('connect', function () {
        client.subscribe('test1', { qos: 2 }, function () {
          assert.strictEqual(Object.keys(client.messageIdToTopic).length, 0)

          client.subscribe(['test2', 'test3'], { qos: 2 }, function () {
            assert.strictEqual(Object.keys(client.messageIdToTopic).length, 0)
            client.end(done)
          })
        })
      })
    })
  })
}
