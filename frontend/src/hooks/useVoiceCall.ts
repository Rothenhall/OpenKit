"use client";

import { useEffect, useRef, useState } from "react";
import type { OrbState } from "@/components/VoiceOrb";
import {
  MIC_WORKLET,
  base64ToArrayBuffer,
  bytesToBase64,
  concatFloat,
  encodeWav,
  resample,
} from "@/lib/audio";
import {
  api,
  voiceSocketUrl,
  type CallView,
} from "@/lib/leads";

export type WsStatus = "off" | "connecting" | "live" | "error";

interface Options {
  initialCall: CallView;
  onError: (message: string) => void;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Voice activity tuning.
// Speech starts above a threshold that follows the room's noise floor, so a
// fan or a quiet mic both work. While the agent talks the bar is higher, so
// its own voice leaking back never cuts it off by itself.
const VOICE_MIN_RMS = 0.018;
const VOICE_MAX_RMS = 0.05;
const BARGE_MIN_RMS = 0.07;
const NOISE_MULT = 3;
const ONSET_MS = 60;
const MIN_VOICE_MS = 200;
const SEND_SILENCE_MS = 700;
const MAX_TURN_MS = 45_000;
const PRE_ROLL_MS = 300;
const TRAIL_KEEP_MS = 250;
const BARGE_SUSTAIN_MS = 450;
const BARGE_GRACE_MS = 500;
const SEND_RATE = 16000;

interface Segment {
  blocks: Float32Array[];
  ms: number;
  voiceMs: number;
  quietMs: number;
  runMs: number;
  overlapped: boolean;
  barged: boolean;
}

/**
 * A phone call in a hook. Voice only, no typing. The mic stays open for the
 * whole call: talk any time, even over the agent, and the agent yields.
 * Pause and the turn sends by itself. Ends at the practice limit or decay.
 *
 * Speed comes from streaming. The server sends the agent's reply one spoken
 * sentence at a time, and each clip is scheduled on the audio clock the
 * moment it arrives, so the agent starts talking while it is still writing.
 */
export function useVoiceCall({ initialCall, onError }: Options) {
  const [call, setCall] = useState<CallView>(initialCall);
  // True once the call is over. The scorecard itself never reaches the
  // browser: it is emailed as a PDF when the visitor gives an address.
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [begun, setBegun] = useState(false);
  const [waitingReply, setWaitingReply] = useState(false);
  // Audio sent, transcript not back yet. The user's own line is pending.
  const [transcribing, setTranscribing] = useState(false);
  const [greeted, setGreeted] = useState(false);
  // Null until mounted: browser capability cannot be read on the server.
  const [unsupported, setUnsupported] = useState<string | null>(null);
  // A short, friendly nudge. Not an error: it clears itself.
  const [hint, setHint] = useState("");
  const [wsStatus, setWsStatus] = useState<WsStatus>("off");
  const [recording, setRecording] = useState(false);
  const [userTalking, setUserTalking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [orbLevel, setOrbLevel] = useState(0.12);
  const [secondsLeft, setSecondsLeft] = useState(
    initialCall.practiceMinutes * 60_000,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    node: AudioWorkletNode;
    source: MediaStreamAudioSourceNode;
  } | null>(null);
  const micStartingRef = useRef(false);
  const segRef = useRef<Segment | null>(null);
  const preRollRef = useRef<{ blocks: Float32Array[]; ms: number }>({
    blocks: [],
    ms: 0,
  });
  const vadRef = useRef({
    noise: 0.008,
    onsetMs: 0,
    talking: false,
    // How long the agent has been audibly speaking, on the mic's own clock.
    agentMs: 0,
  });
  const orbTickRef = useRef(0);

  // Playback. One AudioContext schedules every clip back to back, so
  // sentences join with no gap and stop instantly on a barge in.
  const playCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  // Which reply clips have started playing, so an interrupt can say how much was heard.
  const clipStartsRef = useRef<{ seq: number; when: number }[]>([]);
  const nextTimeRef = useRef(0);
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const playEpochRef = useRef(0);
  const replyClosedRef = useRef(true);
  const ignoreChunksRef = useRef(false);
  const streamingTurnRef = useRef(false);
  const levelRafRef = useRef(0);
  const speakWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCompleteRef = useRef(false);

  const callRef = useRef(call);
  const completeRef = useRef(complete);
  const endCallRef = useRef<() => Promise<void>>(async () => undefined);
  const begunRef = useRef(false);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  const waitingReplyRef = useRef(false);
  const micDeniedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callRef.current = call;
    completeRef.current = complete;
    begunRef.current = begun;
    mutedRef.current = muted;
    speakingRef.current = speaking;
    waitingReplyRef.current = waitingReply;
    micDeniedRef.current = micDenied;
  });

  useEffect(() => {
    const reason = !window.isSecureContext
      ? "Voice calls need a secure (https) page."
      : !navigator.mediaDevices?.getUserMedia
        ? "This browser cannot use the microphone."
        : typeof AudioWorkletNode === "undefined" ||
            !(
              window.AudioContext ||
              (window as unknown as { webkitAudioContext?: unknown })
                .webkitAudioContext
            )
          ? "This browser is too old for live audio."
          : typeof WebSocket === "undefined"
            ? "This browser cannot hold a live connection."
            : "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnsupported(reason);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(""), 4500);
    return () => clearTimeout(id);
  }, [hint]);

  // If the answer is slow, say so instead of leaving the user in silence.
  useEffect(() => {
    if (!waitingReply && !transcribing) return;
    const id = setTimeout(
      () => setHint("Taking a little longer than usual, still on it"),
      8000,
    );
    return () => clearTimeout(id);
  }, [waitingReply, transcribing]);

  const orbState: OrbState = userTalking
    ? "listening"
    : speaking
      ? "speaking"
      : busy || waitingReply || transcribing || wsStatus === "connecting"
        ? "thinking"
        : "idle";

  function fail(message: string) {
    onError(message);
  }

  function setTalking(next: boolean) {
    if (vadRef.current.talking === next) return;
    vadRef.current.talking = next;
    setUserTalking(next);
  }

  function send(event: string, data: unknown = {}) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ event, data }));
  }

  // ---------------------------------------------------------------- playback

  function ensurePlayback(): AudioContext {
    if (!playCtxRef.current || playCtxRef.current.state === "closed") {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      playCtxRef.current = ctx;
      gainRef.current = gain;
      analyserRef.current = analyser;
      nextTimeRef.current = 0;
    }
    void playCtxRef.current.resume().catch(() => undefined);
    return playCtxRef.current;
  }

  /** Drives the orb from the real playback waveform while the agent speaks. */
  function startLevelLoop() {
    cancelAnimationFrame(levelRafRef.current);
    const analyser = analyserRef.current;
    if (!analyser) return;
    const wave = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
      const rms = Math.sqrt(sum / wave.length);
      setOrbLevel(Math.min(1, Math.max(0.12, rms * 4)));
      levelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function finishSpeaking() {
    if (speakWatchdogRef.current) clearTimeout(speakWatchdogRef.current);
    speakWatchdogRef.current = null;
    cancelAnimationFrame(levelRafRef.current);
    speakingRef.current = false;
    setSpeaking(false);
    setOrbLevel(0.12);
    // The end of the call that arrived while the agent was still saying
    // goodbye waits for the last word instead of cutting it off.
    if (pendingCompleteRef.current) {
      pendingCompleteRef.current = false;
      showComplete();
    }
  }

  /** Called whenever a clip ends or the reply closes. Ends speaking when everything is done. */
  function maybeIdle() {
    if (sourcesRef.current.size === 0 && replyClosedRef.current) {
      finishSpeaking();
      loopTick();
    }
  }

  /** Decode and schedule one clip. Decoding is chained so clips never reorder. */
  function playClip(base64: string, seq: number) {
    const epoch = playEpochRef.current;
    const ctx = ensurePlayback();
    decodeChainRef.current = decodeChainRef.current.then(async () => {
      if (epoch !== playEpochRef.current) return;
      try {
        const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(base64));
        if (epoch !== playEpochRef.current) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainRef.current!);
        const when = Math.max(ctx.currentTime + 0.02, nextTimeRef.current);
        nextTimeRef.current = when + buffer.duration;
        sourcesRef.current.add(source);
        clipStartsRef.current.push({ seq, when });
        source.onended = () => {
          sourcesRef.current.delete(source);
          if (epoch === playEpochRef.current) maybeIdle();
        };
        if (!speakingRef.current) {
                    setSpeaking(true);
          speakingRef.current = true;
          startLevelLoop();
        }
        source.start(when);
        // Safety net so a stuck clip can never leave the call looking busy.
        if (speakWatchdogRef.current) clearTimeout(speakWatchdogRef.current);
        speakWatchdogRef.current = setTimeout(
          () => {
            sourcesRef.current.clear();
            replyClosedRef.current = true;
            finishSpeaking();
          },
          Math.max(8000, (nextTimeRef.current - ctx.currentTime) * 1000 + 6000),
        );
      } catch {
        // A clip that cannot decode is skipped, the transcript still shows it.
      }
    });
  }

  /** Stops speaking right now and invalidates clips still decoding or in flight. */
  function stopPlayback() {
    playEpochRef.current++;
    decodeChainRef.current = Promise.resolve();
    for (const source of sourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    sourcesRef.current.clear();
    nextTimeRef.current = 0;
    replyClosedRef.current = true;
    speakingRef.current = false;
    finishSpeaking();
  }

  /** The user talked over the agent. Cut it off here and on the server. */
  function bargeIn() {
    // The last clip that had started when the user cut in. The server keeps
    // only what was heard in the call history, so the next answer fits.
    const now = playCtxRef.current?.currentTime ?? 0;
    const playedSeq = clipStartsRef.current.reduce(
      (last, c) => (c.when <= now ? Math.max(last, c.seq) : last),
      -1,
    );
    ignoreChunksRef.current = true;
    stopPlayback();
    setWaitingReply(false);
    waitingReplyRef.current = false;
    send("interrupt", { playedSeq });
  }

  // ----------------------------------------------------------------- the call

  function showComplete() {
    setWaitingReply(false);
    stopMic();
    setComplete(true);
    setCall((c) => ({ ...c, ended: true }));
  }

  function stopMic() {
    segRef.current = null;
    preRollRef.current = { blocks: [], ms: 0 };
    vadRef.current = { ...vadRef.current, onsetMs: 0, talking: false };
    setUserTalking(false);
    const mic = micRef.current;
    micRef.current = null;
    if (mic) {
      mic.node.port.onmessage = null;
      try {
        mic.source.disconnect();
        mic.node.disconnect();
      } catch {
        // already torn down
      }
      mic.stream.getTracks().forEach((t) => t.stop());
      void mic.ctx.close().catch(() => undefined);
    }
    setRecording(false);
    if (!speakingRef.current) setOrbLevel(0.12);
  }

  async function endCall() {
    const c = callRef.current;
    if (c.ended && completeRef.current) return;
    stopMic();
    stopPlayback();
    setBusy(true);
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        send("end");
      } else {
        await api.endCall(c.callId);
        showComplete();
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : "End call failed");
    } finally {
      setBusy(false);
    }
  }

  // Practice clock. Frozen at full time until the user taps Begin, then it
  // counts down to the backend expiry and ends the call by itself.
  useEffect(() => {
    endCallRef.current = endCall;
  });
  useEffect(() => {
    if (!begun) return;
    const tick = () => {
      const left = initialCall.endsAt - Date.now();
      setSecondsLeft(left);
      if (left <= 0 && !callRef.current.ended && !completeRef.current) {
        void endCallRef.current();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [initialCall.endsAt, begun]);

  const shownLeft = begun
    ? secondsLeft
    : initialCall.practiceMinutes * 60_000;

  function connectVoice(callId: string) {
    manualCloseRef.current = false;
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    const previous = wsRef.current;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }
    setWsStatus("connecting");
    const ws = new WebSocket(voiceSocketUrl(callId));
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("live");
      retryCountRef.current = 0;
      loopTick();
    };
    ws.onerror = () => setWsStatus("error");
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      // Unexpected drops reconnect with backoff while the call is alive.
      // Manual disconnects and finished calls stay off.
      if (manualCloseRef.current) {
        setWsStatus("off");
        return;
      }
      const alive =
        begunRef.current && !callRef.current.ended && !completeRef.current;
      if (!alive) {
        setWsStatus("off");
        return;
      }
      // The reply in flight is gone with the socket. Do not leave the call
      // stuck on "thinking".
      setWaitingReply(false);
      setTranscribing(false);
      const attempt = retryCountRef.current;
      if (attempt >= 5) {
        setWsStatus("error");
        fail("Voice dropped. Tap to reconnect.");
        return;
      }
      retryCountRef.current = attempt + 1;
      setWsStatus("connecting");
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(
        () => connectVoice(callRef.current.callId),
        Math.min(500 * 2 ** attempt, 6000),
      );
    };
    ws.onmessage = (msg) => {
      try {
        const { event, data } = JSON.parse(String(msg.data));
        onServerEvent(event, data);
      } catch {
        // ignore malformed frames
      }
    };
  }

  function onServerEvent(
    event: string,
    data: {
      text?: string;
      audio?: string;
      language?: CallView["language"];
      ended?: boolean;
      streamed?: boolean;
      seq?: number;
      message?: string;
    } & Record<string, unknown>,
  ) {
    if (event === "heard") {
      // A new turn is underway. Late clips from the old reply are done for.
      ignoreChunksRef.current = false;
      streamingTurnRef.current = false;
      clipStartsRef.current = [];
      setTranscribing(false);
      setWaitingReply(true);
      waitingReplyRef.current = true;
      setCall((c) => ({
        ...c,
        turns: [...c.turns, { speaker: "user", text: data.text ?? "" }],
      }));
    } else if (event === "agent_chunk") {
      if (ignoreChunksRef.current) return;
      setWaitingReply(false);
      setGreeted(true);
      replyClosedRef.current = false;
      const text = data.text ?? "";
      const startsTurn = !streamingTurnRef.current;
      streamingTurnRef.current = true;
      setCall((c) => {
        const turns = [...c.turns];
        const last = turns.at(-1);
        if (!startsTurn && last && last.speaker === "agent") {
          turns[turns.length - 1] = { ...last, text: `${last.text} ${text}` };
        } else {
          turns.push({ speaker: "agent", text });
        }
        return { ...c, language: data.language ?? c.language, turns };
      });
      if (data.audio) playClip(data.audio, Number(data.seq ?? 0));
    } else if (event === "agent") {
      if (ignoreChunksRef.current) return;
      setWaitingReply(false);
      setGreeted(true);
      if (data.streamed) {
        // The reply is complete. The full text replaces the stitched chunks.
        streamingTurnRef.current = false;
        replyClosedRef.current = true;
        setCall((c) => {
          const turns = [...c.turns];
          const last = turns.at(-1);
          if (last && last.speaker === "agent" && data.text)
            turns[turns.length - 1] = { ...last, text: data.text };
          return {
            ...c,
            language: data.language ?? c.language,
            ended: data.ended ?? c.ended,
            turns,
          };
        });
        maybeIdle();
      } else {
        // The greeting: one clip, already in the transcript from the call view.
        setCall((c) => {
          const last = c.turns.at(-1);
          if (last && last.speaker === "agent" && last.text === data.text)
            return { ...c, language: data.language ?? c.language };
          return {
            ...c,
            language: data.language ?? c.language,
            ended: data.ended ?? c.ended,
            turns: [...c.turns, { speaker: "agent", text: data.text ?? "" }],
          };
        });
        replyClosedRef.current = false;
        if (data.audio) {
          playClip(data.audio, 0);
          replyClosedRef.current = true;
        } else {
          replyClosedRef.current = true;
          loopTick();
        }
      }
    } else if (event === "call_complete") {
      if (speakingRef.current) {
        // Let the agent finish its last line before the email form takes over.
        pendingCompleteRef.current = true;
        stopMic();
      } else {
        showComplete();
      }
    } else if (event === "error" || event === "no_speech") {
      setWaitingReply(false);
      setTranscribing(false);
      waitingReplyRef.current = false;
      ignoreChunksRef.current = false;
      const message = data.message ?? "Voice error";
      if (message.includes("Practice time")) {
        void endCallRef.current();
      } else if (event === "no_speech") {
        setHint("Didn't catch that, say it once more");
      } else {
        fail(message);
      }
    }
  }

  function disconnectVoice() {
    manualCloseRef.current = true;
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    stopMic();
    stopPlayback();
    wsRef.current?.close();
    wsRef.current = null;
    setWsStatus("off");
  }

  useEffect(
    () => () => {
      manualCloseRef.current = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (speakWatchdogRef.current) clearTimeout(speakWatchdogRef.current);
      wsRef.current?.close();
      const mic = micRef.current;
      if (mic) {
        mic.stream.getTracks().forEach((t) => t.stop());
        void mic.ctx.close().catch(() => undefined);
      }
      cancelAnimationFrame(levelRafRef.current);
      if (playCtxRef.current) {
        void playCtxRef.current.close().catch(() => undefined);
      }
    },
    [],
  );

  /**
   * The open mic loop. One session for the whole call: the mic hears
   * everything, turns send on silence, and sustained speech over the agent
   * cuts the agent off. Just talk, like a phone call.
   */
  function loopTick() {
    if (!begunRef.current || mutedRef.current || micDeniedRef.current) return;
    if (completeRef.current || callRef.current.ended) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    void startMic();
  }

  /** User taps Start call. A real tap unlocks the speaker and the mic. */
  async function begin() {
    if (begunRef.current) return;
    begunRef.current = true;
    setBegun(true);
    // Created inside the tap so the browser lets greeting audio play.
    ensurePlayback();
    connectVoice(callRef.current.callId);
    await startMic();
  }

  function toggleMute() {
    if (mutedRef.current) {
      mutedRef.current = false;
      setMuted(false);
      loopTick();
    } else {
      mutedRef.current = true;
      setMuted(true);
      stopMic();
    }
  }

  /** Tap target when the mic needs permission again. Runs in a gesture. */
  async function retryMic() {
    setMicDenied(false);
    micDeniedRef.current = false;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectVoice(callRef.current.callId);
    }
    await startMic();
  }

  // --------------------------------------------------------------- mic and VAD

  /** One mic session for the whole call. Idempotent. */
  async function startMic() {
    if (
      micRef.current ||
      micStartingRef.current ||
      mutedRef.current ||
      micDeniedRef.current ||
      completeRef.current ||
      callRef.current.ended
    )
      return;
    micStartingRef.current = true;
    try {
      // Echo cancellation and noise suppression give Saaras cleaner audio.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      // Muted or ended while the permission prompt was open.
      if (mutedRef.current || completeRef.current || callRef.current.ended) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      // Safari starts a context created after an await in the suspended state.
      await ctx.resume().catch(() => undefined);
      const url = URL.createObjectURL(
        new Blob([MIC_WORKLET], { type: "application/javascript" }),
      );
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "mic-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      node.port.onmessage = (e: MessageEvent<Float32Array>) =>
        onMicBlock(e.data, ctx.sampleRate);
      source.connect(node);
      micRef.current = { stream, ctx, node, source };
      setRecording(true);
    } catch {
      setMicDenied(true);
      micDeniedRef.current = true;
      fail("Mic blocked. Allow mic access to talk on the call.");
    } finally {
      micStartingRef.current = false;
    }
  }

  /** Runs for every 128 sample block off the mic, a few milliseconds apart. */
  function onMicBlock(block: Float32Array, sampleRate: number) {
    if (mutedRef.current) return;
    const dt = (block.length / sampleRate) * 1000;
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    const rms = Math.sqrt(sum / block.length);
    const vad = vadRef.current;

    const agentLive = speakingRef.current;
    vad.agentMs = agentLive ? vad.agentMs + dt : 0;
    const voiceBar = Math.min(
      VOICE_MAX_RMS,
      Math.max(VOICE_MIN_RMS, vad.noise * NOISE_MULT),
    );
    const bar = agentLive ? Math.max(BARGE_MIN_RMS, voiceBar * 2.5) : voiceBar;
    const isVoice = rms > bar;
    // Learn the room's noise floor from quiet frames only.
    if (!isVoice && rms < VOICE_MAX_RMS) vad.noise = vad.noise * 0.995 + rms * 0.005;

    // Orb follows the mic while the user talks and the agent is quiet.
    if (!agentLive && ++orbTickRef.current % 4 === 0)
      setOrbLevel(Math.min(1, Math.max(0.12, rms * 5)));

    let seg = segRef.current;
    if (!seg) {
      const roll = preRollRef.current;
      roll.blocks.push(block);
      roll.ms += dt;
      while (roll.ms > PRE_ROLL_MS && roll.blocks.length > 1) {
        roll.ms -= (roll.blocks[0].length / sampleRate) * 1000;
        roll.blocks.shift();
      }
      vad.onsetMs = isVoice ? vad.onsetMs + dt : 0;
      if (vad.onsetMs < ONSET_MS) return;
      // Speech began. The pre-roll keeps the first syllable the detector
      // needed a few milliseconds to notice.
      seg = {
        blocks: [...roll.blocks],
        ms: roll.ms,
        voiceMs: vad.onsetMs,
        quietMs: 0,
        runMs: vad.onsetMs,
        overlapped: agentLive,
        barged: false,
      };
      segRef.current = seg;
      preRollRef.current = { blocks: [], ms: 0 };
      vad.onsetMs = 0;
      setTalking(true);
      return;
    }

    seg.blocks.push(block);
    seg.ms += dt;
    if (agentLive) seg.overlapped = true;
    if (isVoice) {
      seg.voiceMs += dt;
      seg.runMs += dt;
      seg.quietMs = 0;
      setTalking(true);
    } else {
      seg.quietMs += dt;
      if (seg.quietMs > 200) seg.runMs = 0;
      if (seg.quietMs > 400) setTalking(false);
    }

    // Barge in: sustained voice over the agent, or while it is still
    // thinking, cancels the reply. The grace period keeps playback onset
    // from triggering it.
    if (
      !seg.barged &&
      (agentLive || waitingReplyRef.current) &&
      seg.runMs >= BARGE_SUSTAIN_MS &&
      (!agentLive || vad.agentMs >= BARGE_GRACE_MS)
    ) {
      seg.barged = true;
      bargeIn();
    }

    const done = seg.quietMs >= SEND_SILENCE_MS;
    if (done || seg.ms >= MAX_TURN_MS) {
      segRef.current = null;
      setTalking(false);
      finishTurn(seg, sampleRate);
    }
  }

  /** Encodes the finished turn and sends it, unless it was echo or noise. */
  function finishTurn(seg: Segment, sampleRate: number) {
    if (
      seg.voiceMs < MIN_VOICE_MS ||
      callRef.current.ended ||
      completeRef.current ||
      !begunRef.current
    )
      return;
    // Voice that only ever overlapped the agent without cutting in was the
    // agent's own voice leaking back, not the user.
    if (seg.overlapped && !seg.barged) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Trim the long silent tail. Less audio up means a faster transcript.
    const trailBlocks = Math.floor(
      (seg.quietMs - TRAIL_KEEP_MS) / ((128 / sampleRate) * 1000),
    );
    const blocks =
      trailBlocks > 0 ? seg.blocks.slice(0, -trailBlocks) : seg.blocks;
    const pcm = resample(concatFloat(blocks), sampleRate, SEND_RATE);
    const wav = encodeWav(pcm, SEND_RATE);
    setTranscribing(true);
    send("audio", { audio: bytesToBase64(wav), mime: "audio/wav" });
  }

  return {
    call,
    complete,
    busy,
    begun,
    waitingReply,
    transcribing,
    greeted,
    hint,
    unsupported,
    wsStatus,
    recording,
    userTalking,
    speaking,
    muted,
    micDenied,
    orbState,
    orbLevel,
    clock: mmss(shownLeft),
    urgent: shownLeft < 60_000,
    fractionLeft: Math.max(
      0,
      Math.min(1, shownLeft / (initialCall.practiceMinutes * 60_000)),
    ),
    endCall,
    begin,
    toggleMute,
    retryMic,
    disconnectVoice,
    reconnectVoice: () => connectVoice(callRef.current.callId),
  };
}
