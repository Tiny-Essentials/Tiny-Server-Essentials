import { EventEmitter } from 'events';

/** @typedef {'video'|'audio'|HTMLVideoElement|HTMLAudioElement} ReceiverTags */

/**
 * TinyMediaReceiver is a lightweight media stream handler designed to manage
 * continuous streaming of audio or video chunks into an HTMLMediaElement using MediaSource.
 *
 * It handles buffering, memory cleanup, and playback synchronization, allowing for dynamic
 * appending of media data and auto-cleaning old buffer segments to preserve memory and prevent playback issues.
 *
 * This class supports custom configuration such as buffer size, cleanup interval, and buffer tolerance.
 * It emits events throughout the lifecycle, such as when the media source is open, buffer is cleaned,
 * time is synced, or an error occurs.
 *
 * Example usage:
 * ```js
 * const receiver = new TinyMediaReceiver({
 *   element: 'audio',
 *   mimeType: 'audio/webm;codecs=opus'
 * });
 * receiver.push(someAudioChunk);
 * ```
 *
 * @class
 * @beta
 */
class TinyMediaReceiver extends EventEmitter {
  /**
   * Event labels used internally and externally for stream control and monitoring.
   * These events are emitted or listened to over socket or internal dispatch.
   * @readonly
   */
  Events = {
    /**
     * Emitted when the buffer has been successfully cleaned.
     * Useful for freeing up memory or managing playback state.
     * @type {'BufferCleaned'}
     */
    BufferCleaned: 'BufferCleaned',

    /**
     * Emitted to synchronize the playback time, typically used
     * when aligning multiple streams or correcting drift.
     * @type {'SyncTime'}
     */
    SyncTime: 'SyncTime',

    /**
     * Event name emitted when the instance is destroyed.
     * This constant can be used to subscribe to the destruction event of the instance.
     * @type {'Destroyed'}
     */
    Destroyed: 'Destroyed',

    /**
     * Emitted when an error occurs in the stream process.
     * Can be used to log or handle critical failures.
     * @type {'Error'}
     */
    Error: 'Error',

    /**
     * Emitted when the MediaSource becomes open and is ready for SourceBuffer initialization.
     * @type {'SourceOpen'}
     */
    SourceOpen: 'SourceOpen',

    /**
     * Emitted when a new chunk of data is being fed into the SourceBuffer queue.
     * Useful for tracking data flow or debugging buffering behavior.
     * @type {'FeedQueue'}
     */
    FeedQueue: 'FeedQueue',
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

  /** @type {HTMLMediaElement|null} */
  #element = null;
  #url = '';

  /** @type {null|NodeJS.Timeout} */
  #cleanupBuffer = null;

  /**
   * Handles the `sourceopen` event from the MediaSource.
   * Initializes the SourceBuffer and starts feeding data into it.
   * Emits an error and destroys the instance if the MIME type is not supported.
   *
   * @private
   * @returns {void}
   */
  _onSourceOpen() {
    if (!MediaSource.isTypeSupported(this.mimeType)) {
      const err = new Error(`MIME type ${this.mimeType} not supported.`);
      console.error(err);
      this.emit(this.Events.Error, err);
      this.destroy();
      return;
    }

    this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
    this.sourceBuffer.mode = 'sequence'; // garante ordem
    this.sourceBuffer.addEventListener('updateend', () => this._feedQueue());
    this.emit(this.Events.SourceOpen);
    this._feedQueue();
  }

  /**
   * Feeds queued media chunks into the SourceBuffer if it's ready.
   * Emits FeedQueue event for each chunk and handles errors by emitting an Error event and destroying the instance.
   *
   * @private
   * @returns {void}
   */
  _feedQueue() {
    if (!this.sourceBuffer || this.queue.length === 0 || this.sourceBuffer.updating) return;
    const chunk = this.queue.shift();
    try {
      this.emit(this.Events.FeedQueue, chunk);
      // @ts-ignore
      this.sourceBuffer.appendBuffer(chunk);
      if (this.queue.length > 0) this._feedQueue();
    } catch (e) {
      console.error('Failed to append buffer:', e);
      this.emit(this.Events.Error, e);
      this.destroy();
    }
  }

  /**
   * Cleans the SourceBuffer to maintain a limited buffer size.
   * Removes old buffered data that exceeds the configured max buffer back.
   * Also adjusts the currentTime if it leaves the valid buffered range.
   * Emits BufferCleaned and SyncTime events when appropriate.
   *
   * @private
   * @returns {void}
   */
  _cleanupBuffer() {
    if (!this.sourceBuffer || !this.#element) return;
    if (!this.sourceBuffer.buffered || this.sourceBuffer.updating) return;

    const media = this.#element;
    const buffered = this.sourceBuffer.buffered;
    const maxBack = this.getMaxBufferBack();
    const tolerance = this.getTolerance();

    if (buffered.length === 0) return;

    const bufferStart = buffered.start(0);
    const bufferEnd = buffered.end(buffered.length - 1);
    const bufferedDuration = bufferEnd - bufferStart;

    // Cleans only if the buffer total exceeds the limit
    if (bufferedDuration > maxBack + tolerance) {
      const extra = bufferedDuration - maxBack;
      const removeEnd = bufferStart + extra;

      try {
        this.sourceBuffer.remove(bufferStart, removeEnd);
        this.emit(this.Events.BufferCleaned, { from: bufferStart, to: removeEnd });
      } catch (e) {
        console.warn('Failed to clean buffer range:', e);
      }
    }

    // Fixes currentTime if it leaves the allowed range
    const idealTime = bufferEnd - 0.1;
    const minTime = bufferEnd - maxBack;

    if (media.currentTime < minTime + tolerance || media.currentTime > bufferEnd - tolerance) {
      media.currentTime = idealTime;
      this.emit(this.Events.SyncTime, idealTime);
    }
  }

  /**
   * Initializes a media player for continuous streaming from received chunks.
   *
   * @param {Object} [options={}]
   * @param {ReceiverTags} [options.element] - The tag to attach the stream.
   * @param {string} [options.mimeType] - The mime type, e.g., 'audio/webm;codecs=opus'.
   * @param {number} [options.maxBufferBack=10] - Maximum buffer (in seconds) back to keep in the buffer behind the current time.
   * @param {number} [options.cleanupTime] - Interval time in milliseconds to perform buffer cleanup. Must be a positive number.
   * @param {number} [options.bufferTolerance] - Tolerance value (in seconds) used when comparing buffer ranges. Must be a positive number.
   */
  constructor({
    element,
    mimeType,
    maxBufferBack = 10,
    cleanupTime = 100,
    bufferTolerance = 0.1,
  } = {}) {
    super();
    if (typeof mimeType !== 'string' || !MediaSource.isTypeSupported(mimeType))
      throw new Error(`MIME type not supported: ${mimeType}`);
    if (!Number.isInteger(maxBufferBack) || maxBufferBack <= 0)
      throw new Error('Expected a positive number in maxBufferBack.');
    if (typeof cleanupTime !== 'number' || cleanupTime <= 0)
      throw new Error('Expected a positive number for cleanupTime.');
    if (typeof bufferTolerance !== 'number' || bufferTolerance <= 0)
      throw new Error('Expected a positive number for bufferTolerance.');

    this.mimeType = mimeType;
    /** @type {BufferSource[]} */
    this.queue = [];
    this.sourceBuffer = null;
    this.mediaSource = new MediaSource();
    this.isBufferUpdating = false;
    this.isEnded = false;
    this.maxBufferBack = maxBufferBack;
    this.tolerance = bufferTolerance;

    if (typeof element === 'string') {
      if (element !== 'audio' && element !== 'video')
        throw new Error("element must be either 'audio' or 'video'.");
      this.#element = document.createElement(element);
    } else if (element instanceof HTMLMediaElement) this.#element = element;
    else throw new Error('Expected a string (tag name) or an HTMLMediaElement instance.');

    this.#element.src = this.#url;
    this.#element.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      this._onSourceOpen();
    });

    this.#cleanupBuffer = setInterval(() => this._cleanupBuffer(), cleanupTime);
  }

  /**
   * Returns the current buffer tolerance in seconds.
   * @returns {number} The current tolerance value.
   */
  getTolerance() {
    if (typeof this.tolerance !== 'number' || this.tolerance <= 0)
      throw new Error('Tolerance must be a positive number.');
    return this.tolerance;
  }

  /**
   * Sets a new buffer tolerance value.
   *
   * @param {number} value - The new tolerance value in seconds. Must be a positive number.
   * @throws {Error} If the value is not a positive number.
   */
  setTolerance(value) {
    if (typeof value !== 'number' || value <= 0)
      throw new Error('Tolerance must be a positive number.');
    this.tolerance = value;
  }

  /**
   * Gets the maximum buffer back.
   * Only returns a positive integer.
   * @returns {number}
   */
  getMaxBufferBack() {
    if (!Number.isInteger(this.maxBufferBack) || this.maxBufferBack <= 0)
      throw new Error(
        `[MediaStream] Invalid internal maxBufferBack detected (${this.maxBufferBack}), resetting to 30.`,
      );
    return this.maxBufferBack;
  }

  /**
   * Sets the maximum buffer back.
   * Value must be a positive integer.
   * @param {number} value
   */
  setMaxBufferBack(value) {
    if (!Number.isInteger(value) || value <= 0)
      throw new Error(`[MediaStream] maxBufferBack must be a positive integer. Received: ${value}`);
    this.maxBufferBack = value;
  }

  /** @returns {HTMLMediaElement} */
  getElement() {
    if (!(this.#element instanceof HTMLMediaElement))
      throw new Error('Element is not a valid HTMLMediaElement');
    return this.#element;
  }

  /**
   * Pushes a new chunk of media data to the playback buffer.
   * @param {ArrayBuffer} buffer
   */
  pushChunk(buffer) {
    if (this.isEnded) return new Promise((resolve) => resolve(undefined));
    this.queue.push(buffer);
    this._feedQueue();
  }

  /**
   * Alias for `pushChunk`.
   * @param {ArrayBuffer} buffer
   */
  push(buffer) {
    return this.pushChunk(buffer);
  }

  /**
   * Finalizes the media stream and releases resources.
   */
  destroy() {
    if (!this.isEnded && this.mediaSource.readyState === 'open') {
      this.isEnded = true;
      const tryEnd = () => {
        if (!this.sourceBuffer) throw new Error('No sourcerBuffer');
        if (!this.sourceBuffer.updating && this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
          URL.revokeObjectURL(this.#url);
          if (this.#element) {
            this.#element.remove();
            this.#element = null;
          }
          if (this.#cleanupBuffer) clearInterval(this.#cleanupBuffer);
          this.emit(this.Events.Destroyed);
          this.removeAllListeners();
        } else {
          setTimeout(tryEnd, 100);
        }
      };
      tryEnd();
    }
  }
}

export default TinyMediaReceiver;
