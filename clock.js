const MIDI_MESSAGE = Object.freeze({
    START: new Uint8Array([0xFA]),
    CLOCK: new Uint8Array([0xF8]),
    STOP: new Uint8Array([0xFC])
});

class Clock {
    constructor() {
        this.absoluteTime = 0.0;
        this.nextScheduleTime = 0.0;
        this.bpm = 120.0;
        this.$intervalId = -1;
        this.clockIndex = 0;
        this.outputs = [];
        this.tempOutputs = [];
    }

    isRunning() {
        return -1 < this.$intervalId;
    }

    start() {
        if (this.isRunning()) {
            return;
        }
        this.outputs = this.tempOutputs.slice(); // move to working copy
        this.nextScheduleTime = performance.now() + Clock.LOOK_AHEAD_TIME;
        this.$intervalId = setInterval(_ => {
            const now = performance.now();
            if (now + Clock.LOOK_AHEAD_TIME >= this.nextScheduleTime) {
                const m0 = this.absoluteTime;
                const m1 = m0 + Clock.SCHEDULE_TIME;
                const t0 = this.millisToBars(m0, this.bpm);
                const t1 = this.millisToBars(m1, this.bpm);
                let barPosition = this.clockIndex / 96.0;
                while (barPosition < t1) {
                    if (barPosition >= t0) {
                        const millis = this.computeStartMillis(barPosition);
                        if (this.clockIndex === 0) {
                            for (const target of this.outputs) {
                                target.send(MIDI_MESSAGE.START, millis);
                            }
                        }
                        for (const target of this.outputs) {
                            target.send(MIDI_MESSAGE.CLOCK, millis);
                        }
                    }
                    barPosition = ++this.clockIndex / 96.0;
                }
                this.absoluteTime += Clock.SCHEDULE_TIME;
                this.nextScheduleTime += Clock.SCHEDULE_TIME;
            }
        }, Clock.INTERVAL);
    }

    stop() {
        if (!this.isRunning()) {
            return;
        }
        for (const target of this.outputs) {
            target.send(MIDI_MESSAGE.STOP);
        }
        clearInterval(this.$intervalId);
        this.$intervalId = -1;
        this.clockIndex = 0;
        this.absoluteTime = 0.0;
    }

    setBpm(value) {
        const bars = this.millisToBars(this.absoluteTime);
        this.bpm = value;
        this.absoluteTime = this.barsToMillis(bars);
    }

    getBpm() {
        return this.bpm;
    }

    computeStartMillis(barPosition) {
        return (this.nextScheduleTime - this.absoluteTime) +
            this.barsToMillis(barPosition, this.bpm) + Clock.ADDITIONAL_LATENCY;
    }

    barsToMillis(bars) {
        return bars * 240000.0 / this.bpm;
    };

    millisToBars(millis) {
        return millis * this.bpm / 240000.0;
    };

    addOutput(output) {
        this.tempOutputs.push(output);
    }

    removeOutput(output) {
        this.tempOutputs = this.tempOutputs.filter(t => t !== output);
    }
}

Clock.INTERVAL = 1.0;
Clock.LOOK_AHEAD_TIME = 10.0;
Clock.SCHEDULE_TIME = 10.0;
Clock.ADDITIONAL_LATENCY = 10.0;

const init = () => {
    const labelStatus = document.querySelector("form.devices label.status");
    if (!navigator["requestMIDIAccess"]) {
        labelStatus.textContent = "Your browser does not support web-midi. (Currently only Chrome does)";
        return;
    }
    navigator.requestMIDIAccess()
        .catch(reason => labelStatus.textContent = reason)
        .then(midiAccess => {
            labelStatus.remove();
            const clock = new Clock();
            const devices = document.querySelector("form.devices fieldset");
            const template = devices.querySelector("template").content;
            const buttonToggle = document.querySelector("button#toggle");
            const inputBpm = document.querySelector("input#bpm");
            const start = () => {
                clock.start();
                buttonToggle.textContent = "■";
                devices.disabled = true;
            };
            const stop = () => {
                clock.stop();
                buttonToggle.textContent = "▶";
                devices.disabled = false;
            };
            const toggle = () => {
                if (clock.isRunning()) {
                    stop();
                } else {
                    start();
                }
            };
            inputBpm.oninput = () => {
                const value = parseFloat(inputBpm.value);
                if (!isNaN(value)) {
                    const clamped = Math.max(30.0, Math.min(300.0, value));
                    clock.setBpm(clamped);
                }
            };
            inputBpm.onblur = () => inputBpm.value = clock.getBpm();
            buttonToggle.onclick = () => toggle();
            document.onvisibilitychange = () => {
                if (document.hidden) {
                    // If the tab does into background, all timers are being stopped by the browser anyway
                    stop();
                }
            };
            midiAccess.outputs.forEach(output => {
                const element = template.cloneNode(true);
                const checkbox = element.querySelector("input");
                checkbox.checked = true;
                checkbox.oninput = () => {
                    if (checkbox.checked) {
                        clock.addOutput(output);
                    } else {
                        clock.removeOutput(output);
                    }
                };
                element.querySelector("span").textContent = `${output.name} (${output.manufacturer})`;
                devices.appendChild(element);
                clock.addOutput(output);
            });
        });
};

window.onload = () => init();