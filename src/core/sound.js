class RocketSound {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.isPlaying = false;
        this.volume = 0.5;
        this.targetVolume = 0.5;
        
        this.noiseNode = null;
        this.filter = null;
        this.gainNode = null;
    }

    createNoiseNode() {
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        this.noiseNode = this.audioContext.createBufferSource();
        this.noiseNode.buffer = noiseBuffer;
        this.noiseNode.loop = true;

        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'bandpass';
        this.filter.frequency.value = 50;
        this.filter.Q.value = 1.5;

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;

        this.noiseNode.connect(this.filter);
        this.filter.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
    }

    start() {
        if (this.isPlaying) return;
   
        this.createNoiseNode();
        
        this.noiseNode.start();
        this.isPlaying = true;

    }

    stop() {
        if (!this.isPlaying) return;
        if (this.noiseNode) {
            this.noiseNode.stop();
    
        }
        this.noiseNode = null;
        this.isPlaying = false;
       
    }

    setVolume(value) {
        this.targetVolume = Math.max(0, Math.min(1, value));
        if (value > 0 && !this.isPlaying) {
            this.start();
        }
    }

    updateVolume() {
        if (!this.isPlaying) return;

        
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }

        requestAnimationFrame(() => this.updateVolume());
    }
}