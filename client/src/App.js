import React, { useRef, useState, useEffect } from "react";
import io from "socket.io-client";
import mediasoupClient, { Device } from "mediasoup-client";
import Videos from "./Components/Videos";

const url = "http://127.0.0.1:8088/mediasoup";
// Hermieoni

function App() {
  const localVideo = useRef();
  const socket = useRef(null);

  let device;
  let rtpCapabilities;
  let producerTransport;
  let [consumerTransports, setConsumerTransports] = useState([]);
  let audioProducer;
  let videoProducer;
  let consumer;
  // eslint-disable-next-line
  let isProducer = false;

  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  let params = {
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S1T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };

  let audioParams;
  let videoParams = { params };
  let [consumingTransports, setConsumingTransports] = useState([]);

  useEffect(() => {
    socket.current = io.connect(url, {
      path: "/io/webrtc",
    });
    socket.current.on("connection-success", ({ socketId }) => {
      console.log(socketId, "what happened?");
      getLocalStream();
    });

    const run = async () => {
      await socket.current.on("new-producer", ({ producerId }) => {
        console.log(consumerTransports, "total users");
        signalNewConsumerTransport(producerId);
      });

      await socket.current.on("producer-closed", ({ remoteProducerId }) => {
        // server notification is received when a producer is closed
        // we need to close the client-side consumer and associated transport
        const producerToClose = consumerTransports.find(
          (transportData) => transportData.producerId === remoteProducerId,
        );
        producerToClose.consumerTransport.close();
        producerToClose.consumer.close();

        const finalProducers = consumerTransports.filter(
          (transportData) => transportData.producerId !== remoteProducerId,
        );
        setConsumerTransports(finalProducers);
      });
    };
    run();
    // server informs the client of a new producer just joined
  }, [consumerTransports, consumingTransports]);

  const streamSuccess = (stream) => {
    window.localStream = stream;
    console.log(stream, "are you here");
    localVideo.current.srcObject = stream;

    audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

    console.log(">>>> audio", audioParams, ">>>> video", videoParams);

    joinRoom();
  };

  const joinRoom = () => {
    console.log("the join room step 2.");
    const roomName = window.location.pathname;
    socket.current.emit("joinRoom", { roomName }, (data) => {
      console.log(
        `Router RTP Capabilities... ${data.rtpCapabilities}`,
        data.rtpCapabilities,
      );
      // we assign to local variable and will be used when
      // loading the client Device (see createDevice above)
      rtpCapabilities = data.rtpCapabilities;

      // once we have rtpCapabilities from the Router, create Device
      createDevice();
    });
  };

  const getLocalStream = () => {
    console.log("The step 1.");
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: {
          width: {
            min: 640,
            max: 1920,
          },
          height: {
            min: 400,
            max: 1080,
          },
        },
      })
      .then(streamSuccess)
      .catch((err) => {
        console.log(err.message);
      });
  };
  // A device is an endpoint connecting to a Router on the
  // server side to send/recive media
  const createDevice = async () => {
    console.log("create device the step 3.");
    try {
      // console.log(new mediasoupClient());
      // const mediaDevice = new mediasoupClient();
      device = new Device();
      console.log(device, "the device properties");

      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
      // Loads the device with RTP capabilities of the Router (server side)
      await device.load({
        // see getRtpCapabilities() below
        routerRtpCapabilities: rtpCapabilities,
      });

      console.log("Device RTP Capabilities", device.rtpCapabilities);

      // once the device loads, create transport
      createSendTransport();
    } catch (err) {
      console.log(err.message);
      if (err.name === "UnsupportedError") {
        console.warn("browser not supported");
      }
    }
  };

  const createSendTransport = () => {
    console.log("create send transport step 4.");
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.current.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-connect', ...)
              await socket.current.emit("trasnport-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (err) {
              errback(err);
            }
          },
        );

        producerTransport.on(
          "produce",
          async (parameters, callback, errback) => {
            console.log(parameters);

            try {
              // tell the server to create a Producer
              // with the following parameters and produce
              // and expect back a server side producer id
              // see server's socket.on('transport-produce', ...)
              await socket.current.emit(
                "transport-produce",
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appata: parameters.appData,
                },
                ({ id, producerExist }) => {
                  // Tell the transport that parameters were transmitted and provide it with the
                  // server side producer's id.
                  callback({ id });

                  // if producers exist, then join room
                  if (producerExist) {
                    getProducers();
                  }
                },
              );
            } catch (err) {
              errback(err);
            }
          },
        );

        connectSendTransport();
      },
    );
  };

  const connectSendTransport = async () => {
    console.log("connect send transport step 5.");
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);

    audioProducer.on("trackended", () => {
      console.log("audio track");

      // close audio track
    });

    audioProducer.on("transportclose", () => {
      console.log("audio trasport ended");

      // close audio track
    });

    videoProducer.on("trackended", () => {
      console.log("video track ended");

      // close video track
    });

    videoProducer.on("transportclose", () => {
      console.log("video trasnport ended");

      // close video track
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId) => {
    console.log("convert to the consumers step 7.");
    //check if we are already consuming the remoteProducerId
    if (consumingTransports.includes(remoteProducerId)) return;
    setConsumingTransports((pre) => [...pre, remoteProducerId]);

    await socket.current.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(`PARAMS... ${params}`);

        let consumerTransport;
        try {
          consumerTransport = device.createRecvTransport(params);
        } catch (err) {
          // exceptions:
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(err);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await socket.current.emit("transport-recv-connet", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (err) {
              // Tell the transport that something was wrong
              errback(err);
            }
          },
        );

        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      },
    );
  };

  // // server informs the client of a new producer just joined
  // socket.current.on("new-producer", ({ producerId }) => {
  //   console.log(consumerTransports, "total users");
  //   signalNewConsumerTransport(producerId);
  // });

  const getProducers = () => {
    console.log("if producer exists step 6.");
    socket.current.emit("getProducers", (producerIds) => {
      console.log(producerIds);
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId,
  ) => {
    console.log("sending the server step 8.");
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.current.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        debugger;
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(`Consumer Params ${params}`, params, "the the params....");
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume(params);

        console.log(consumer, "the consumer");

        setConsumerTransports((pre) => [
          ...pre,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]);

        // create a new div element for the new consumer media ... which is done.

        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket.current.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
      },
    );
  };

  // socket.current.on("producer-closed", ({ remoteProducerId }) => {
  //   // server notification is received when a producer is closed
  //   // we need to close the client-side consumer and associated transport
  //   const producerToClose = consumerTransports.find(
  //     (transportData) => transportData.producerId === remoteProducerId,
  //   );
  //   producerToClose.consumerTransport.close();
  //   producerToClose.consumer.close();

  //   const finalProducers = consumerTransports.filter(
  //     (transportData) => transportData.producerId !== remoteProducerId,
  //   );
  //   setConsumerTransports(finalProducers);
  // });

  return (
    <div>
      Hello everyone
      <div
        style={{
          width: 200,
          margin: 5,
          borderRadius: 5,
          backgroundColor: "black",
        }}
      >
        <video
          ref={localVideo}
          autoPlay
          muted
          style={{
            width: 200,
          }}
        ></video>
        <button onClick={getLocalStream}>Allow Camera and Mic</button>
      </div>
      <div
        style={{
          zIndex: 3,
          position: "fixed",
          padding: "6px 3px",
          backgroundColor: "rgba(0,0,0,0.3)",
          maxHeight: 120,
          top: "auto",
          right: 10,
          left: 10,
          bottom: 10,
          overflowX: "scroll",
          whiteSpace: "nowrap",
        }}
      >
        {consumerTransports.length > 0 &&
          consumerTransports.map((user, ind) => (
            <Videos key={ind} consumer={user.consumer} />
          ))}
      </div>
    </div>
  );
}

export default App;
