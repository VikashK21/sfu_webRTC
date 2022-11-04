import React, { useRef, useEffect } from "react";

function Videos({ consumer }) {
  const remoteVideo = useRef();

  useEffect(() => {
    const { _track } = consumer;
    console.log(consumer, "the data coming through the loop");
    console.log(_track, "the tracks of the consumers");
    remoteVideo.current.srcObject = new MediaStream([_track]);
  }, [consumer]);
  return (
    <div
      style={{
        width: 120,
        float: "left",
        padding: "0 3px",
        backgroundColor: "black",
      }}
    >
      {consumer.kind === "audio" && <audio autoPlay></audio>}
      <video
        ref={remoteVideo}
        autoPlay
        style={{
          cursor: "pointer",
          objectFit: "cover",
          borderRadius: 3,
          width: "100%",
        }}
      ></video>
    </div>
  );
}

export default Videos;
