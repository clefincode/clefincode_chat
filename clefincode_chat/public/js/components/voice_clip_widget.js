export default class VoiceClip {
  constructor(opts) {
    this.chat_space = opts.chat_space;
    this.stream = null;
    this.setup();
  }

  async setup() {
    this.$voice_clip = $(document.createElement("span")).addClass("voice-clip")
      .append(`
        <svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve">
            <path fill="currentColor" d="M11.999,14.942c2.001,0,3.531-1.53,3.531-3.531V4.35c0-2.001-1.53-3.531-3.531-3.531 S8.469,2.35,8.469,4.35v7.061C8.469,13.412,9.999,14.942,11.999,14.942z M18.237,11.412c0,3.531-2.942,6.002-6.237,6.002 s-6.237-2.471-6.237-6.002H3.761c0,4.001,3.178,7.297,7.061,7.885v3.884h2.354v-3.884c3.884-0.588,7.061-3.884,7.061-7.885 L18.237,11.412z"></path>
        </svg>            
        `);

    this.$voice_message = $(document.createElement("span")).addClass(
      "voice-message"
    ).append(`
        <div class="remove-voice-message" style="cursor: pointer; display: inline-block;">
            <svg viewBox="0 0 24 24" height="20" width="20" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve">
                <path d="M5,0,3,2H0V4H16V2H13L11,0ZM15,5H1V19.5A2.5,2.5,0,0,0,3.5,22h9A2.5,2.5,0,0,0,15,19.5Z" fill="currentColor">
                </path>
            </svg>
        </div>
        <div id="timer" style="display: inline-block;">00:00:00</div>
        <div style="display: inline-block; margin-left: 4px;">
            <canvas  style="width: 150px; height: 28px;"></canvas>
        </div>
            
        <div class="voiceclip-continue-icon" style="color: red; padding:10px;cursor: pointer; display: none;">
            <svg viewBox="0 0 24 24" height="26" width="26" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M11.999,14.942c2.001,0,3.531-1.53,3.531-3.531V4.35c0-2.001-1.53-3.531-3.531-3.531 S8.469,2.35,8.469,4.35v7.061C8.469,13.412,9.999,14.942,11.999,14.942z M18.237,11.412c0,3.531-2.942,6.002-6.237,6.002 s-6.237-2.471-6.237-6.002H3.761c0,4.001,3.178,7.297,7.061,7.885v3.884h2.354v-3.884c3.884-0.588,7.061-3.884,7.061-7.885 L18.237,11.412z"></path>
            </svg>			
        </div>
        <div class="voiceclip-pause-icon" style="color: red; padding:10px;cursor: pointer; display: inline-block;">
            <svg viewBox="0 0 36 36" height="25" width="25" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve">	
                <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2.5"></circle>
                <path style="position: absolute; left:0; top:0; opacity:1; height:100%; width:100%;'" d="M20.65,21.69V10.25H17.31V21.69Zm-9.3-11.44V21.69h3.34V10.25Z" fill="currentColor"></path>
            </svg>
        </div>
        <div class="send-btn" style="width: 40px; cursor: pointer; box-sizing: border-box; display: inline-block;">
            <svg viewBox="0 0 36 36" height="30" width="30" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve">
                <path fill="currentColor" d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845 L1.101,21.757z">
                </path>
            </svg>
        </div>
        `);
    this.handle_voice_clip();
  }

  handle_voice_clip() {
    let context, analyser, source, data;
    let mediaRecorder,
      isPaused = false,
      recordedChunks = [];

    let timerInterval = null;
    let interval = null;
    let totalSeconds = 0;
    let animationFrameId = null;
    let drawTimer = null;
    let lastDrawTime = 0;

    const me = this;

    function startTimer() {
      // Reset any existing timer.
      if (timerInterval === null) {
        totalSeconds = 0;
        me.$voice_message.find("#timer").html("00:00:00");
      }
      // Start a new timer.
      timerInterval = setInterval(function () {
        ++totalSeconds;
        let hour = Math.floor(totalSeconds / 3600);
        let minute = Math.floor((totalSeconds - hour * 3600) / 60);
        let seconds = totalSeconds - (hour * 3600 + minute * 60);

        if (hour < 10) hour = "0" + hour;
        if (minute < 10) minute = "0" + minute;
        if (seconds < 10) seconds = "0" + seconds;

        me.$voice_message
          .find("#timer")
          .html(hour + ":" + minute + ":" + seconds);
      }, 1000);
    }

    function stopTimer() {
      clearInterval(timerInterval);
    }
    function resetTimer() {
      clearInterval(timerInterval);
      totalSeconds = 0;
      timerInterval = null;
    }
    function draw(data) {
      let currentTime = Date.now();
      if (currentTime - lastDrawTime < 60) {
        return;
      }
      lastDrawTime = currentTime;

      const canvas = me.$voice_message.find("canvas")[0];
      const canvasContext = canvas.getContext("2d");

      if (!isPaused) {
        animationFrameId = requestAnimationFrame(() => draw(data));
      }

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(dataArray);

      canvasContext.fillStyle = "rgb(240, 242, 245)";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      canvasContext.lineWidth = 2;
      canvasContext.strokeStyle = "rgb(0, 0, 0)";

      canvasContext.beginPath();

      const sliceWidth = (canvas.width * 1.0) / dataArray.length;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          canvasContext.moveTo(x, y);
        } else {
          canvasContext.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasContext.lineTo(canvas.width, canvas.height / 2);
      canvasContext.stroke();
    }

    function stopdraw() {
      clearInterval(interval);
      interval = null;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    me.$voice_clip.on("click", function () {
      recordedChunks = [];
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((localStream) => {
          // The context is the base for dealing with audio in the browser
          me.stream = localStream;
          startTimer();
          me.chat_space.$chat_actions.find(".message-section").animate(
            {
              left: "+=50",
              opacity: 0,
            },
            500,
            function () {
              // This function is called when the animation is complete.
              $(this).hide().css("left", ""); // Hide the element and reset the left property.
              me.chat_space.$chat_actions
                .find(".voice-section")
                .css({ opacity: 0 })
                .show()
                .animate({ opacity: 1 }, 500);
            }
          );
          context = new AudioContext();

          // The analyser node will allow us to inspect the data of the audio
          analyser = context.createAnalyser();

          // Connect the microphone to the analyser
          source = context.createMediaStreamSource(me.stream);
          source.connect(analyser);

          // Create a data array to store audio data
          data = new Uint8Array(analyser.frequencyBinCount);

          // Create the media recorder

          mediaRecorder = new MediaRecorder(me.stream);
          mediaRecorder.ondataavailable = (e) => {
            recordedChunks.push(e.data);
          };
          mediaRecorder.start();
          // Create an interval to fetch audio data
          interval = setInterval(() => {
            // Get the data
            analyser.getByteFrequencyData(data);

            // Now we can use the data to visualize audio
            draw(data);
          }, 60);
        })
        .catch(console.error);
    });

    me.$voice_message.find(".send-btn").on("click", function () {
      // Stop recording
      resetTimer();
      stopdraw();
      mediaRecorder.stop();
      context.close();
      // Stop the media stream
      const tracks = me.stream.getTracks();
      tracks.forEach((track) => {
        track.stop();
      });

      me.chat_space.$chat_actions.find(".voice-section").animate(
        {
          left: "+=50",
          opacity: 0,
        },
        500,
        function () {
          // This function is called when the animation is complete.
          $(this).hide().css("left", ""); // Hide the element and reset the left property.
          me.chat_space.$chat_actions
            .find(".message-section")
            .css({ opacity: 0 })
            .show()
            .animate({ opacity: 1 }, 500);
        }
      );

      mediaRecorder.onstop = function () {
        let blob = new Blob(recordedChunks, { type: "audio/aac" });
        recordedChunks = [];

        // convert blob to base64
        let reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = function () {
          let base64data = reader.result;
          // send base64 data to server
          fetch(
            "/api/method/clefincode_chat.api.api_1_0_1.api.save_voice_clip",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-Frappe-CSRF-Token": frappe.csrf_token,
              },
              body: JSON.stringify({
                data: base64data,
                filename: "audio.aac",
                // attached_to_doctype: frm.doc.doctype,
                // attached_to_name: frm.doc.name
              }),
            }
          )
            .then((response) => response.json())
            .then((data) => {
              me.chat_space.handle_send_message(
                data.message.file_url,
                data.message.file_name,
                data.message.file_id
              );
              // cur_frm.sidebar.reload_docinfo();
            })
            .catch((error) => {
              console.error("Error:", error);
            });
        };
      };
    });

    me.$voice_message.find(".voiceclip-pause-icon").on("click", function () {
      stopTimer();
      $(".voiceclip-pause-icon").hide();
      $(".voiceclip-continue-icon").css("display", "inline-block");
      if (mediaRecorder) {
        mediaRecorder.pause();
      }
      isPaused = true;
      if (interval) {
        stopdraw();
      }
    });

    me.$voice_message.find(".voiceclip-continue-icon").on("click", function () {
      startTimer();
      $(".voiceclip-continue-icon").hide();
      $(".voiceclip-pause-icon").css("display", "inline-block");
      if (mediaRecorder && mediaRecorder.state == "paused") {
        mediaRecorder.resume();
      }
      isPaused = false;
      if (!interval) {
        interval = setInterval(() => {
          // Get the data
          analyser.getByteFrequencyData(data);

          // Now we can use the data to visualize audio
          draw(data);
        }, 60);
      }
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(() => draw(data));
      }
    });

    me.$voice_message.find(".remove-voice-message").on("click", function () {
      resetTimer();
      stopdraw();
      recordedChunks = [];
      context.close();
      // Stop the media stream
      const tracks = me.stream.getTracks();
      tracks.forEach((track) => {
        track.stop();
      });

      me.chat_space.$chat_actions.find(".voice-section").animate(
        {
          left: "+=50",
          opacity: 0,
        },
        500,
        function () {
          // This function is called when the animation is complete.
          $(this).hide().css("left", ""); // Hide the element and reset the left property.
          me.chat_space.$chat_actions
            .find(".message-section")
            .css({ opacity: 0 })
            .show()
            .animate({ opacity: 1 }, 500);
        }
      );
    });
  }
} //End Class
