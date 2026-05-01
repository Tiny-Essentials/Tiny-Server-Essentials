import { EventEmitter } from 'events';
import TinyPromiseQueue from '../tiny-modules/libs/TinyPromiseQueue.mjs';
import VolumeMeter from './VolumeMeter.mjs';
import TinyMediaReceiver from './TinyMediaReceiver.mjs';

/** @typedef {'mic'|'cam'|'screen'} StreamTypes */
/** @typedef {'Mic'|'Cam'|'Screen'} StreamEventTypes */
/** @typedef {import('./TinyMediaReceiver.mjs').ReceiverTags} ReceiverTags */

/**
 * @typedef {Object} StreamConfig
 * @property {string} mimeType - A valid MIME type for MediaRecorder.
 * @property {number} timeslice - Interval in milliseconds for emitting data chunks.
 * @property {string|null} audioCodec - Audio codec that can be used
 * @property {string|null} videoCodec - Video codec that can be used
 */

/**
 * @typedef {Object} MandatoryConstraints
 * @property {'screen'|'window'|'application'|'desktop'} [chromeMediaSource]
 *     Capture source for Chrome/Electron.
 * @property {string} [chromeMediaSourceId]
 *     Specific ID of the capture source (usually obtained via desktopCapturer).
 * @property {number} [maxWidth]
 *     Maximum width of the capture.
 * @property {number} [maxHeight]
 *     Maximum height of the capture.
 * @property {number} [maxFrameRate]
 *     Maximum frame rate.
 * @property {number} [minWidth]
 *     Minimum width of the capture.
 * @property {number} [minHeight]
 *     Minimum height of the capture.
 * @property {number} [minFrameRate]
 *     Minimum frame rate.
 * @property {boolean} [googLeakyBucket]
 *     Experimental setting used in some Chromium versions.
 * @property {boolean} [googTemporalLayeredScreencast]
 *     Experimental setting for temporal layers in screen capture.
 */

/**
 * @typedef {Object} AdvancedScreenVideoConstraints
 * @property {'screen'|'window'|'application'|'browser'|'monitor'} [mediaSource]
 *     Capture source, useful in Electron and Firefox.
 * @property {string} [chromeMediaSource]
 *     Used in older versions of Chrome/Electron. Usually 'desktop'.
 * @property {string} [chromeMediaSourceId]
 *     Used in Electron to select a specific screen or window.
 * @property {number} [frameRate]
 *     Desired capture frame rate (e.g., 30 or 60).
 * @property {number} [width]
 *     Ideal capture width.
 * @property {number} [height]
 *     Ideal capture height.
 * @property {MandatoryConstraints} [mandatory]
 *     Allows configuring advanced fields in Electron/Chrome (like `chromeMediaSource`).
 */

/**
 * @typedef {Object} ScreenShareConstraints
 * @property {boolean|MediaTrackConstraints} [audio]
 * @property {boolean|AdvancedScreenVideoConstraints|MediaTrackConstraints} video
 *     Constraints for screen capture, can be simple (true) or detailed.
 */

/**
 * Manages media streams (microphone, camera, screen) with flexible device constraints,
 * socket emission support, and audio volume metering.
 *
 * This class:
 * - Allows starting and managing media input streams (mic, cam, screen).
 * - Supports custom constraints and device targeting via deviceId or full constraint objects.
 * - Emits media streams to a socket or handler using predefined labels (mic, cam, screen, etc.).
 * - Provides audio volume metering for microphone and screen when audio is available.
 * - Supports Electron-specific constraints when applicable.
 *
 * Events emitted:
 * - `"Mic"`: Audio stream from microphone.
 * - `"MicMeter"`: Volume level from microphone.
 * - `"Cam"`: Video stream from webcam.
 * - `"Screen"`: Video stream from screen capture.
 * - `"ScreenMeter"`: Volume level from screen audio.
 *
 * Internally uses:
 * - `navigator.mediaDevices.getUserMedia` for mic/cam.
 * - `navigator.mediaDevices.getDisplayMedia` for screen sharing.
 * - Optional support for `chromeMediaSource` and related properties in Electron environments.
 *
 * @class
 * @beta
 */
export class TinyStreamManager {
  #loadingDevices = false;
  #queue = new TinyPromiseQueue();
  #firstLoad = false;

  /** @type {Map<string, TinyMediaReceiver>} */
  #streams = new Map();

  /**
   * Important instance used to make event emitter.
   * @type {EventEmitter}
   */
  #events = new EventEmitter();

  /**
   * Important instance used to make system event emitter.
   * @type {EventEmitter}
   */
  #sysEvents = new EventEmitter();
  #sysEventsUsed = false;

  /**
   * Event labels used internally and externally for stream control and monitoring.
   * These events are emitted or listened to over socket or internal dispatch.
   * @readonly
   */
  Events = {
    /**
     * Event name emitted when the instance is destroyed.
     * This constant can be used to subscribe to the destruction event of the instance.
     * @type {'Destroyed'}
     */
    Destroyed: 'Destroyed',

    /**
     * Emitted when a media data receiver (e.g., WebSocket, PeerConnection, etc.) has been removed.
     * This may happen when a connection is closed or explicitly terminated.
     * @type {'ReceiverDeleted'}
     */
    ReceiverDeleted: 'ReceiverDeleted',

    /**
     * Emitted when a new media data receiver has been added to the stream.
     * Useful for dynamic systems where receivers can join at runtime.
     * @type {'ReceiverAdded'}
     */
    ReceiverAdded: 'ReceiverAdded',

    /**
     * Event emitted to request starting the webcam stream.
     * @type {'StartCam'}
     */
    StartCam: 'StartCam',

    /**
     * Event emitted to request starting the microphone stream.
     * @type {'StartMic'}
     */
    StartMic: 'StartMic',

    /**
     * Event emitted to request starting the screen sharing stream.
     * @type {'StartScreen'}
     */
    StartScreen: 'StartScreen',

    /**
     * Event emitted to request stopping the webcam stream.
     * @type {'StopCam'}
     */
    StopCam: 'StopCam',

    /**
     * Event emitted to request stopping the microphone stream.
     * @type {'StopMic'}
     */
    StopMic: 'StopMic',

    /**
     * Event emitted to request stopping the screen sharing stream.
     * @type {'StopScreen'}
     */
    StopScreen: 'StopScreen',

    /**
     * Event emitted when the webcam stream is transmitted.
     * @type {'Cam'}
     */
    Cam: 'Cam',

    /**
     * Event emitted when the microphone stream is transmitted.
     * @type {'Mic'}
     */
    Mic: 'Mic',

    /**
     * Event emitted when the screen sharing stream is transmitted.
     * @type {'Screen'}
     */
    Screen: 'Screen',

    /**
     * Event emitted periodically with screen audio volume data.
     * @type {'ScreenMeter'}
     */
    ScreenMeter: 'ScreenMeter',

    /**
     * Event emitted periodically with microphone audio volume data.
     * @type {'MicMeter'}
     */
    MicMeter: 'MicMeter',
  };

  /**
   * Checks whether a given event name is defined in the Events map.
   *
   * This method verifies if the provided string matches one of the predefined
   * event labels (e.g., "Mic", "Cam", "Screen", "MicMeter", "ScreenMeter").
   *
   * @param {string} name - The name of the event to check.
   * @returns {boolean} Returns `true` if the event exists in the Events map, otherwise `false`.
   */
  existsEvent(name) {
    // @ts-ignore
    if (typeof this.Events[name] === 'string') return true;
    return false;
  }

  /**
   * Emits an event with optional arguments to all system emit.
   * @param {string | symbol} event - The name of the event to emit.
   * @param {...any} args - Arguments passed to event listeners.
   */
  #emit(event, ...args) {
    this.#events.emit(event, ...args);
    if (this.#sysEventsUsed) this.#sysEvents.emit(event, ...args);
  }

  /**
   * Provides access to a secure internal EventEmitter for subclass use only.
   *
   * This method exposes a dedicated EventEmitter instance intended specifically for subclasses
   * that extend the main class. It prevents subclasses from accidentally or intentionally using
   * the primary class's public event system (`emit`), which could lead to unpredictable behavior
   * or interference in the base class's event flow.
   *
   * For security and consistency, this method is designed to be accessed only once.
   * Multiple accesses are blocked to avoid leaks or misuse of the internal event bus.
   *
   * @returns {EventEmitter} A special internal EventEmitter instance for subclass use.
   * @throws {Error} If the method is called more than once.
   */
  getSysEvents() {
    if (this.#sysEventsUsed)
      throw new Error(
        'Access denied: getSysEvents() can only be called once. ' +
          'This restriction ensures subclass event isolation and prevents accidental interference ' +
          'with the main class event emitter.',
      );
    this.#sysEventsUsed = true;
    return this.#sysEvents;
  }

  /**
   * @typedef {(...args: any[]) => void} ListenerCallback
   * A generic callback function used for event listeners.
   */

  /**
   * Sets the maximum number of listeners for the internal event emitter.
   *
   * @param {number} max - The maximum number of listeners allowed.
   */
  setMaxListeners(max) {
    this.#events.setMaxListeners(max);
  }

  /**
   * Emits an event with optional arguments.
   * @param {string | symbol} event - The name of the event to emit.
   * @param {...any} args - Arguments passed to event listeners.
   * @returns {boolean} `true` if the event had listeners, `false` otherwise.
   */
  emit(event, ...args) {
    return this.#events.emit(event, ...args);
  }

  /**
   * Registers a listener for the specified event.
   * @param {string | symbol} event - The name of the event to listen for.
   * @param {ListenerCallback} listener - The callback function to invoke.
   * @returns {this} The current class instance (for chaining).
   */
  on(event, listener) {
    this.#events.on(event, listener);
    return this;
  }

  /**
   * Registers a one-time listener for the specified event.
   * @param {string | symbol} event - The name of the event to listen for once.
   * @param {ListenerCallback} listener - The callback function to invoke.
   * @returns {this} The current class instance (for chaining).
   */
  once(event, listener) {
    this.#events.once(event, listener);
    return this;
  }

  /**
   * Removes a listener from the specified event.
   * @param {string | symbol} event - The name of the event.
   * @param {ListenerCallback} listener - The listener to remove.
   * @returns {this} The current class instance (for chaining).
   */
  off(event, listener) {
    this.#events.off(event, listener);
    return this;
  }

  /**
   * Alias for `on`.
   * @param {string | symbol} event - The name of the event.
   * @param {ListenerCallback} listener - The callback to register.
   * @returns {this} The current class instance (for chaining).
   */
  addListener(event, listener) {
    this.#events.addListener(event, listener);
    return this;
  }

  /**
   * Alias for `off`.
   * @param {string | symbol} event - The name of the event.
   * @param {ListenerCallback} listener - The listener to remove.
   * @returns {this} The current class instance (for chaining).
   */
  removeListener(event, listener) {
    this.#events.removeListener(event, listener);
    return this;
  }

  /**
   * Removes all listeners for a specific event, or all events if no event is specified.
   * @param {string | symbol} [event] - The name of the event. If omitted, all listeners from all events will be removed.
   * @returns {this} The current class instance (for chaining).
   */
  removeAllListeners(event) {
    this.#events.removeAllListeners(event);
    return this;
  }

  /**
   * Returns the number of times the given `listener` is registered for the specified `event`.
   * If no `listener` is passed, returns how many listeners are registered for the `event`.
   * @param {string | symbol} eventName - The name of the event.
   * @param {Function} [listener] - Optional listener function to count.
   * @returns {number} Number of matching listeners.
   */
  listenerCount(eventName, listener) {
    return this.#events.listenerCount(eventName, listener);
  }

  /**
   * Adds a listener function to the **beginning** of the listeners array for the specified event.
   * The listener is called every time the event is emitted.
   * @param {string | symbol} eventName - The event name.
   * @param {ListenerCallback} listener - The callback function.
   * @returns {this} The current class instance (for chaining).
   */
  prependListener(eventName, listener) {
    this.#events.prependListener(eventName, listener);
    return this;
  }

  /**
   * Adds a **one-time** listener function to the **beginning** of the listeners array.
   * The next time the event is triggered, this listener is removed and then invoked.
   * @param {string | symbol} eventName - The event name.
   * @param {ListenerCallback} listener - The callback function.
   * @returns {this} The current class instance (for chaining).
   */
  prependOnceListener(eventName, listener) {
    this.#events.prependOnceListener(eventName, listener);
    return this;
  }

  /**
   * Returns an array of event names for which listeners are currently registered.
   * @returns {(string | symbol)[]} Array of event names.
   */
  eventNames() {
    return this.#events.eventNames();
  }

  /**
   * Gets the current maximum number of listeners allowed for any single event.
   * @returns {number} The max listener count.
   */
  getMaxListeners() {
    return this.#events.getMaxListeners();
  }

  /**
   * Returns a copy of the listeners array for the specified event.
   * @param {string | symbol} eventName - The event name.
   * @returns {Function[]} An array of listener functions.
   */
  listeners(eventName) {
    return this.#events.listeners(eventName);
  }

  /**
   * Returns a copy of the internal listeners array for the specified event,
   * including wrapper functions like those used by `.once()`.
   * @param {string | symbol} eventName - The event name.
   * @returns {Function[]} An array of raw listener functions.
   */
  rawListeners(eventName) {
    return this.#events.rawListeners(eventName);
  }

  /**
   * @type {{
   *  audio: MediaDeviceInfo[];
   *  speaker: MediaDeviceInfo[];
   *  video: MediaDeviceInfo[];
   * }}
   */
  #devices = {
    audio: [],
    speaker: [],
    video: [],
  };

  /** @type {VolumeMeter|null} */
  micMeter = null;
  /** @type {VolumeMeter|null} */
  screenMeter = null;

  /** @type {MediaStream|null} */
  micStream = null;
  /** @type {MediaStream|null} */
  camStream = null;
  /** @type {MediaStream|null} */
  screenStream = null;
  /** @type {Map<string, MediaRecorder>} */
  #recorders = new Map();

  /**
   * Interval ID returned by setInterval, used to clear the interval later.
   * @type {NodeJS.Timeout | null}
   */
  #monitorIntervalId = null;

  /**
   * Starts the interval that monitors volume meters for mic and screen.
   *
   * This function sets up a `setInterval` that continuously reads audio volume
   * from active meters (if any), calculates a percentage level, and emits
   * events like `'micMeter'` and `'screenMeter'` with detailed volume info.
   *
   * It will not create a new interval if one is already running, or if no meters are active.
   */
  #startMonitorInterval() {
    if (!this.#monitorIntervalId && (this.hasMicMeter() || this.hasScreenMeter())) {
      this.#monitorIntervalId = setInterval(() => {
        /**
         * @param {string} eventName
         * @param {VolumeMeter} audio
         */
        const emitData = (eventName, audio) => {
          let perc = audio.volume * 1000;
          perc = perc < 100 ? (perc > 0 ? perc : 0) : 100;
          this.#emit(eventName, { audio, perc, vol: audio.volume });
        };

        if (this.hasMicMeter()) emitData(this.Events.MicMeter, this.getMicMeter());
        if (this.hasScreenMeter()) emitData(this.Events.ScreenMeter, this.getScreenMeter());
      }, 1);
    }
  }

  /**
   * Stops the interval responsible for monitoring volume meters.
   *
   * This function clears the active monitor interval if it exists
   * and no mic or screen meters are currently active.
   */
  #stopMonitorInterval() {
    if (this.#monitorIntervalId && !this.hasMicMeter() && !this.hasScreenMeter()) {
      clearInterval(this.#monitorIntervalId);
      this.#monitorIntervalId = null;
    }
  }

  /**
   * Configuration used for microphone streaming.
   *
   * @type {StreamConfig}
   */
  #micConfig = {
    mimeType: 'audio/webm',
    audioCodec: 'opus',
    videoCodec: null,
    timeslice: 100,
  };

  /**
   * Configuration used for camera streaming.
   *
   * @type {StreamConfig}
   */
  #camConfig = {
    mimeType: 'video/webm',
    audioCodec: null,
    videoCodec: 'vp9',
    timeslice: 100,
  };

  /**
   * Configuration used for screen streaming.
   *
   * Framerate (FPS)	Timeslice
   * 60 FPS	          ~16.6 ms
   * 30 FPS	          ~33.3 ms
   * 15 FPS	          ~66.6 ms
   * 10 FPS           ~100 ms
   *
   * @type {StreamConfig}
   */
  #screenConfig = {
    mimeType: 'video/webm',
    audioCodec: 'opus',
    videoCodec: 'vp9',
    timeslice: 500,
  };

  /**
   * Updates the configuration for a specific media source.
   *
   * @param {StreamTypes} target - The config to update.
   * @param {{ mimeType?: string, timeslice?: number }} updates - The new configuration values.
   *
   * @throws {Error} If the target is invalid.
   * @throws {Error} If the mimeType is invalid or unsupported.
   * @throws {Error} If the timeslice is not a positive finite number.
   */
  updateMediaConfig(target, updates = {}) {
    if (!['mic', 'cam', 'screen'].includes(target))
      throw new Error(`Invalid config target: "${target}"`);

    const currentConfig = {
      mic: this.#micConfig,
      cam: this.#camConfig,
      screen: this.#screenConfig,
    }[target];

    const updated = { ...currentConfig };

    if ('mimeType' in updates) {
      const mime = updates.mimeType;
      if (typeof mime !== 'string' || !MediaRecorder.isTypeSupported(mime))
        throw new Error(`Invalid or unsupported MIME type: "${mime}"`);
      updated.mimeType = mime;
    }

    if ('timeslice' in updates) {
      const slice = updates.timeslice;
      if (typeof slice !== 'number' || !Number.isFinite(slice) || slice <= 0)
        throw new Error(`Invalid timeslice: must be a positive number (got ${slice})`);
      updated.timeslice = slice;
    }

    switch (target) {
      case 'mic':
        this.#micConfig = updated;
        break;
      case 'cam':
        this.#camConfig = updated;
        break;
      case 'screen':
        this.#screenConfig = updated;
        break;
    }
  }

  /**
   * Returns the current microphone stream if it is a valid MediaStream.
   *
   * @returns {MediaStream} The active microphone stream.
   * @throws {Error} If the microphone stream is not a valid MediaStream.
   */
  getMicStream() {
    if (!(this.micStream instanceof MediaStream))
      throw new Error('Microphone stream is not a valid MediaStream');
    return this.micStream;
  }

  /**
   * Returns the current webcam stream if it is a valid MediaStream.
   *
   * @returns {MediaStream} The active webcam stream.
   * @throws {Error} If the webcam stream is not a valid MediaStream.
   */
  getCamStream() {
    if (!(this.camStream instanceof MediaStream))
      throw new Error('Webcam stream is not a valid MediaStream');
    return this.camStream;
  }

  /**
   * Returns the current screen sharing stream if it is a valid MediaStream.
   *
   * @returns {MediaStream} The active screen sharing stream.
   * @throws {Error} If the screen stream is not a valid MediaStream.
   */
  getScreenStream() {
    if (!(this.screenStream instanceof MediaStream))
      throw new Error('Screen stream is not a valid MediaStream');
    return this.screenStream;
  }

  /**
   * Returns the current microphone volume meter if it is a valid VolumeMeter instance.
   *
   * @returns {VolumeMeter} The active microphone volume meter.
   * @throws {Error} If the microphone meter is not a valid VolumeMeter instance.
   */
  getMicMeter() {
    if (!(this.micMeter instanceof VolumeMeter))
      throw new Error('Microphone meter is not a valid VolumeMeter instance.');
    return this.micMeter;
  }

  /**
   * Returns the current screen volume meter if it is a valid VolumeMeter instance.
   *
   * @returns {VolumeMeter} The active screen volume meter.
   * @throws {Error} If the screen meter is not a valid VolumeMeter instance.
   */
  getScreenMeter() {
    if (!(this.screenMeter instanceof VolumeMeter))
      throw new Error('Screen meter is not a valid VolumeMeter instance.');
    return this.screenMeter;
  }

  /**
   * Checks if the microphone volume meter exists and is a valid VolumeMeter instance.
   *
   * @returns {boolean} True if micMeter exists and is valid, false otherwise.
   */
  hasMicMeter() {
    return this.micMeter instanceof VolumeMeter;
  }

  /**
   * Checks if the screen volume meter exists and is a valid VolumeMeter instance.
   *
   * @returns {boolean} True if screenMeter exists and is valid, false otherwise.
   */
  hasScreenMeter() {
    return this.screenMeter instanceof VolumeMeter;
  }

  /**
   * Creates an instance of the media device manager.
   *
   * This constructor initializes the internal socket reference and sets up the default
   * structure for tracking media devices and active media streams. It also automatically
   * triggers a device list update on instantiation.
   */
  constructor() {
    this.updateDeviceList();
  }

  /**
   * Updates the internal list of available media devices.
   *
   * This method queries the user's system for media input and output devices using
   * `navigator.mediaDevices.enumerateDevices()` and categorizes them into three groups:
   * video inputs, audio inputs, and audio outputs (speakers). The result is stored in the
   * `this.devices` object and also returned for immediate use.
   *
   * If the device list cannot be retrieved, it falls back to setting all categories as empty arrays.
   *
   * @returns {Promise<{ video: MediaDeviceInfo[], audio: MediaDeviceInfo[], speaker: MediaDeviceInfo[] }>}
   *          A promise resolving to an object containing categorized media devices.
   */
  async updateDeviceList() {
    if (!this.#loadingDevices) {
      this.#loadingDevices = true;
      await this.#queue.enqueue(async () => {
        const devicesResult = await navigator.mediaDevices?.enumerateDevices?.();
        if (devicesResult) {
          const video = [];
          const audio = [];
          const speaker = [];

          for (const device of devicesResult) {
            switch (device.kind) {
              case 'videoinput':
                video.push(device);
                break;
              case 'audioinput':
                audio.push(device);
                break;
              case 'audiooutput':
                speaker.push(device);
                break;
            }
          }

          this.#devices.audio = audio;
          this.#devices.speaker = speaker;
          this.#devices.video = video;
          this.#firstLoad = true;
        } else {
          this.#devices.audio = [];
          this.#devices.speaker = [];
          this.#devices.video = [];
        }
      });
      this.#loadingDevices = false;
    } else await this.#queue.enqueuePoint(async () => {});
    return {
      video: this.#devices.video,
      audio: this.#devices.audio,
      speaker: this.#devices.speaker,
    };
  }

  /**
   * Retrieves a list of media devices filtered by the specified kind.
   *
   * This method strictly enforces the kind to be one of: 'audio', 'video', or 'speaker'.
   * It throws an error if the input is not a string, not one of the allowed kinds,
   * or if no devices are available for the given kind.
   *
   * @param {'audio' | 'video' | 'speaker'} kind - The type of device to retrieve.
   * @returns {MediaDeviceInfo[]} An array of media devices matching the specified kind.
   * @throws {Error} If the input is not a string.
   * @throws {RangeError} If the input is not one of the accepted device kinds.
   * @throws {Error} If no devices are found for the given kind.
   */
  getDevicesByKind(kind) {
    if (!this.#firstLoad)
      throw new Error('Cannot retrieve devices: the manager has not been initialized.');
    if (typeof kind !== 'string') throw new Error('Parameter "kind" must be a string');
    if (!['audio', 'video', 'speaker'].includes(kind))
      throw new RangeError('Parameter "kind" must be one of: "audio", "video", "speaker"');
    const devices = this.#devices[kind];
    if (!devices) throw new Error(`No devices found for kind: "${kind}"`);
    return devices;
  }

  /**
   * Returns an array containing all available audio, video, and speaker devices.
   *
   * This method throws an error if the manager is not yet initialized.
   *
   * @returns {MediaDeviceInfo[]} An array of all available media devices.
   * @throws {Error} If the manager is not yet initialized.
   */
  getAllDevices() {
    if (!this.#firstLoad)
      throw new Error('Cannot retrieve devices: the manager has not been initialized.');
    return [...this.#devices.speaker, ...this.#devices.audio, ...this.#devices.video];
  }

  /**
   * Stops an active MediaRecorder associated with a specific socket label.
   *
   * This method stops the recording process for the given label if a recorder exists,
   * and removes the recorder reference from the internal map to free up resources.
   *
   * Use this to manually stop sending a stream over the socket.
   *
   * @param {StreamEventTypes} label - The socket event label associated with the recorder (e.g., 'mic', 'cam', 'screen').
   */
  #stopSocketStream(label) {
    const recorder = this.#recorders.get(label);
    if (recorder) {
      recorder.stop();
      this.#recorders.delete(label);
    }
  }

  /**
   * Internal helper to detect when media tracks end, and stop the corresponding socket stream.
   *
   * @param {MediaStream} stream - The media stream being monitored.
   * @param {StreamEventTypes} label - The socket label to stop when the stream ends.
   */
  #stopDeviceDetector(stream, label) {
    if (!(stream instanceof MediaStream)) return;
    stream.getTracks().forEach((track) => {
      track.addEventListener(
        'ended',
        () => {
          this.#emit(`Stop${label}`);
          this.#stopSocketStream(label);
          this.#stopMonitorInterval();
        },
        { once: true },
      );
    });
  }

  /**
   * Starts capturing audio from the microphone with flexible constraints.
   *
   * If a deviceId is provided, it targets a specific microphone. You can also pass in
   * a full MediaTrackConstraints object to fine-tune behavior (e.g., noise suppression, echo cancellation).
   *
   * This method:
   * - Emits the audio stream over the socket under the label `"mic"`.
   * - Starts volume monitoring and emits microphone volume under the label `"micMeter"`.
   *
   * @param {string|MediaTrackConstraints|null} options - Either a deviceId string, a full constraints object, or null for defaults.
   * @param {boolean} hearVoice - `true` =  Hear your voice.
   * @returns {Promise<MediaStream>} A promise resolving to the active audio stream.
   * @throws {Error} If the deviceId is invalid or if no audio track is found in the stream.
   */
  async startMic(options = null, hearVoice = false) {
    let constraints;
    if (typeof options === 'string') {
      const valid = this.#devices.audio.some((d) => d.deviceId === options);
      if (!valid) throw new Error(`Invalid microphone deviceId: ${options}`);
      constraints = { audio: { deviceId: { exact: options } } };
    } else if (typeof options === 'object' && options !== null) {
      // @ts-ignore
      const id = options.deviceId?.exact;
      if (id && !this.#devices.audio.some((d) => d.deviceId === id))
        throw new Error(`Invalid microphone deviceId: ${id}`);
      constraints = { audio: options };
    } else {
      constraints = { audio: true };
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const hasAudio = stream.getAudioTracks().length > 0;
    if (!hasAudio) throw new Error('The microphone stream does not contain any audio track.');

    this.micStream = stream;
    this.micMeter = new VolumeMeter();
    this.micMeter.connectToSource(stream, hearVoice);
    this.#startMonitorInterval();
    this.#emit(this.Events.StartMic);
    this.#sendStreamOverSocket(
      stream,
      { audio: true, video: false },
      this.Events.Mic,
      this.#micConfig,
    );
    return stream;
  }

  /**
   * Starts capturing video from the webcam with flexible constraints.
   *
   * Accepts a deviceId string for a specific webcam, or a full MediaTrackConstraints
   * object to customize video input (resolution, frameRate, etc.).
   *
   * This method:
   * - Emits the video stream over the socket under the label `"cam"`.
   *
   * @param {string|MediaTrackConstraints|null} options - Either a deviceId string, a full constraints object, or null for defaults.
   * @returns {Promise<MediaStream>} A promise resolving to the active video stream.
   * @throws {Error} If the deviceId is invalid.
   */
  async startCam(options = null) {
    let constraints;
    if (typeof options === 'string') {
      const valid = this.#devices.video.some((d) => d.deviceId === options);
      if (!valid) throw new Error(`Invalid webcam deviceId: ${options}`);
      constraints = { video: { deviceId: { exact: options } } };
    } else if (typeof options === 'object' && options !== null) {
      // @ts-ignore
      const id = options.deviceId?.exact;
      if (id && !this.#devices.video.some((d) => d.deviceId === id))
        throw new Error(`Invalid webcam deviceId: ${id}`);
      constraints = { video: options };
    } else {
      constraints = { video: true };
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.camStream = stream;
    this.#emit(this.Events.StartCam);
    this.#sendStreamOverSocket(
      stream,
      { audio: false, video: true },
      this.Events.Cam,
      this.#camConfig,
    );
    return stream;
  }

  /**
   * Starts screen sharing with customizable audio and video constraints.
   *
   * You can pass a boolean to enable or disable audio,
   * or an object to define custom `audio` and `video` constraints.
   *
   * This method:
   * - Emits the screen stream over the socket under the label `"screen"`.
   * - If audio is present, starts volume monitoring and emits under the label `"screenMeter"`.
   *
   * @param {boolean|ScreenShareConstraints} options - `true` = enable audio, `false` = no audio, or an object with audio/video constraints.
   * @param {boolean} hearScreen - `true` =  Hear your screen audio (**Your ear will be destroyed!!!**).
   * @returns {Promise<MediaStream>} A promise resolving to the active screen capture stream.
   * @throws {Error} If the options are invalid.
   */
  async startScreen(options = true, hearScreen = false) {
    let constraints;
    if (typeof options === 'boolean') {
      constraints = {
        video: true,
        audio: options,
      };
    } else if (typeof options === 'object' && options !== null) {
      constraints = {
        video: options.video ?? true,
        audio: options.audio ?? false,
      };
    } else throw new Error('Invalid screen share options.');
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    this.screenStream = stream;
    const hasAudio = stream.getAudioTracks().length > 0;
    if (hasAudio) {
      this.screenMeter = new VolumeMeter();
      this.screenMeter.connectToSource(stream, hearScreen);
    } else this.screenMeter = null;

    this.#startMonitorInterval();
    this.#emit(this.Events.StartScreen);
    this.#sendStreamOverSocket(
      stream,
      { audio: hasAudio, video: true },
      this.Events.Screen,
      this.#screenConfig,
    );
    return stream;
  }

  /**
   * Sends a media stream over the socket using a MediaRecorder.
   *
   * This method starts recording the provided MediaStream using the specified MIME type and interval,
   * and emits the resulting data chunks through the socket under the provided label.
   *
   * It will not start a new recorder if one is already active for the given label.
   *
   * @param {MediaStream} stream - The media stream to send. Must be a valid MediaStream instance.
   * @param {{ audio: boolean; video: boolean; }} allowCodecs - The codecs that are allowed to use.
   * @param {StreamEventTypes} label - The socket channel label used to identify the stream (e.g., 'mic', 'cam', 'screen').
   * @param {StreamConfig} options - Settings for recording.
   *
   * @throws {Error} If the stream is not a valid MediaStream.
   * @throws {Error} If a recorder is already active for the given label.
   * @throws {Error} If the MIME type is not supported by MediaRecorder.
   * @throws {Error} If timeslice is not a positive number.
   * @throws {DOMException} If the MediaRecorder cannot be created with the given stream and options.
   */
  #sendStreamOverSocket(stream, allowCodecs = { audio: true, video: true }, label, options) {
    if (typeof label !== 'string') throw new Error('Parameter "label" must be a valid string.');
    if (!(stream instanceof MediaStream))
      throw new Error('Parameter "stream" must be a valid MediaStream instance.');

    if (this.#recorders.has(label))
      throw new Error(`A recorder for "${label}" is already running.`);

    const mime = `${options.mimeType};codecs=${allowCodecs.video ? options.videoCodec : ''}${allowCodecs.video && allowCodecs.audio ? `,` : ''}${allowCodecs.audio ? options.audioCodec : ''}`;
    const timeslice = options.timeslice ?? 100;

    if (typeof mime !== 'string' || !MediaRecorder.isTypeSupported(mime))
      throw new Error(`Unsupported or invalid MIME type: "${mime}"`);
    if (typeof timeslice !== 'number' || !Number.isFinite(timeslice) || timeslice <= 0)
      throw new Error(`Invalid timeslice: must be a positive number (got ${timeslice})`);

    const recorder = new MediaRecorder(stream, { mimeType: mime });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.#emit(label, { streamData: e.data, mime });
    };

    recorder.start(timeslice);
    this.#recorders.set(label, recorder);
    this.#stopDeviceDetector(stream, label);
  }

  /**
   * Stops the microphone stream if active.
   *
   * Stops all tracks from the current microphone stream and clears its reference.
   * Throws an error if the microphone stream is not set or invalid.
   *
   * @throws {Error} If the microphone stream is not active or invalid.
   */
  stopMic() {
    if (!(this.micStream instanceof MediaStream))
      throw new Error('No active microphone stream to stop.');
    this.micStream.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micMeter = null;
  }

  /**
   * Stops the webcam stream if active.
   *
   * Stops all tracks from the current webcam stream and clears its reference.
   * Throws an error if the webcam stream is not set or invalid.
   *
   * @throws {Error} If the webcam stream is not active or invalid.
   */
  stopCam() {
    if (!(this.camStream instanceof MediaStream))
      throw new Error('No active webcam stream to stop.');
    this.camStream.getTracks().forEach((t) => t.stop());
    this.camStream = null;
  }

  /**
   * Stops the screen sharing stream if active.
   *
   * Stops all tracks from the current screen stream and clears its reference.
   * Throws an error if the screen stream is not set or invalid.
   *
   * @throws {Error} If the screen sharing stream is not active or invalid.
   */
  stopScreen() {
    if (!(this.screenStream instanceof MediaStream))
      throw new Error('No active screen sharing stream to stop.');
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenMeter = null;
  }

  /**
   * Stops all active media streams (microphone, webcam, and screen share).
   *
   * This method calls the individual stop methods to ensure each stream is safely terminated.
   * Use this when you want to stop all media input/output at once.
   */
  stopAll() {
    this.stopMic();
    this.stopCam();
    this.stopScreen();
  }

  /**
   * Generates a unique media identifier string based on the given parameters.
   *
   * @param {string} userId - The ID of the user.
   * @param {string} type - The type/category of the media.
   * @param {string} mime - The MIME type of the media.
   * @param {ReceiverTags} element - The name of the media element.
   * @returns {string} A concatenated string uniquely identifying the media.
   */
  getMediaId(userId, type, mime, element) {
    if (typeof userId !== 'string') throw new Error('userId must be a string.');
    if (typeof type !== 'string') throw new Error('type must be a string.');
    if (typeof mime !== 'string') throw new Error('mime must be a string.');
    // @ts-ignore
    if (!(element instanceof HTMLMediaElement) && typeof element !== 'string')
      throw new Error("element must be either 'string' or 'HTMLMediaElement'.");
    if (typeof element === 'string' && !['video', 'audio'].includes(element))
      throw new Error("element must be either 'audio' or 'video'.");
    if (!['mic', 'cam', 'screen'].includes(type)) throw new Error(`Invalid config type: "${type}"`);
    // @ts-ignore
    return `${userId}:${type}:${mime}:${typeof element === 'string' ? element : element.tagName}`;
  }

  /**
   * Checks if a media receiver exists for the given stream parameters.
   *
   * @param {string} userId - The user id to attach the stream.
   * @param {string} type - The stream type, e.g., 'mic'.
   * @param {string} mime - The mime type, e.g., 'audio/webm;codecs=opus'.
   * @param {ReceiverTags} element - The tag name needs to be `audio` or `video` to attach the stream.
   * @returns {boolean}
   */
  hasReceiver(userId, type, mime, element) {
    const id = this.getMediaId(userId, type, mime, element);
    return this.#streams.has(id);
  }

  /**
   * Deletes a media receiver.
   *
   * @param {string} userId - The user id to attach the stream.
   * @param {string} type - The stream type, e.g., 'mic'.
   * @param {string} mime - The mime type, e.g., 'audio/webm;codecs=opus'.
   * @param {ReceiverTags} element - The tag name needs to be `audio` or `video` to attach the stream.
   */
  deleteReceiver(userId, type, mime, element) {
    const id = this.getMediaId(userId, type, mime, element);
    if (!this.#streams.has(id)) throw new Error('');
    const receiver = this.#streams.get(id);
    receiver?.destroy();
    this.#streams.delete(id);
    this.#emit(this.Events.ReceiverDeleted, { userId, type, mime, element }, receiver);
  }

  /**
   * Gets a media player for continuous streaming from received chunks.
   *
   * @param {string} userId - The user id to attach the stream.
   * @param {string} type - The stream type, e.g., 'mic'.
   * @param {string} mime - The mime type, e.g., 'audio/webm;codecs=opus'.
   * @param {ReceiverTags} element - The tag name needs to be `audio` or `video` to attach the stream.
   * @returns {TinyMediaReceiver} - If the instance has not yet been created, it will be created automatically.
   * @throws {Error} If no media receiver exists for the given parameters.
   */
  getReceiver(userId, type, mime, element) {
    const id = this.getMediaId(userId, type, mime, element);
    const oldReceiver = this.#streams.get(id);
    if (oldReceiver) return oldReceiver;
    throw new Error(`No media receiver found for ID "${id}"`);
  }

  /**
   * Initializes a media player for continuous streaming from received chunks.
   *
   * @param {string} userId - The user id to attach the stream.
   * @param {StreamTypes} type - The stream type, e.g., 'mic'.
   * @param {string} mimeType - The mime type, e.g., 'audio/webm;codecs=opus'.
   * @param {ReceiverTags} element - The tag name needs to be `audio` or `video` to attach the stream.
   * @param {Object} [options={}]
   * @param {number} [options.maxBufferBack=10] - Maximum buffer (in seconds) back to keep in the buffer behind the current time.
   * @param {number} [options.cleanupTime] - Interval time in milliseconds to perform buffer cleanup. Must be a positive number.
   * @param {number} [options.bufferTolerance] - Tolerance value (in seconds) used when comparing buffer ranges. Must be a positive number.
   * @returns {TinyMediaReceiver} - If the instance has not yet been created, it will be created automatically.
   */
  initReceiver(
    userId,
    type,
    mimeType,
    element,
    { maxBufferBack = 10, cleanupTime = 100, bufferTolerance = 0.1 } = {},
  ) {
    const id = this.getMediaId(userId, type, mimeType, element);
    const oldReceiver = this.#streams.get(id);
    if (oldReceiver) return oldReceiver;

    const receiver = new TinyMediaReceiver({
      element,
      mimeType,
      maxBufferBack,
      cleanupTime,
      bufferTolerance,
    });

    this.#streams.set(id, receiver);
    this.#emit(this.Events.ReceiverAdded, { userId, type, mimeType, element }, receiver);
    return receiver;
  }

  /**
   * Destroys the instance by terminating all active streams, stopping processes, and removing all event listeners.
   *
   * This method performs a full cleanup of the instance. It first iterates through all entries in `#streams` and calls
   * their `destroy()` methods to properly dispose of any underlying resources (e.g., sockets, file handles, etc.). After that,
   * it clears the `#streams` map entirely. It also calls `stopAll()` to terminate any ongoing operations or processes,
   * and finally removes all listeners from both `#events` and `#sysEvents` to avoid memory leaks or unintended side effects.
   *
   * Call this method when the instance is no longer needed or before disposing of it.
   *
   * @returns {void}
   */
  destroy() {
    this.#streams.forEach((value) => {
      value.destroy();
    });
    this.#streams.clear();
    this.stopAll();
    this.#emit(this.Events.Destroyed);
    this.#events.removeAllListeners();
    this.#sysEvents.removeAllListeners();
  }
}
